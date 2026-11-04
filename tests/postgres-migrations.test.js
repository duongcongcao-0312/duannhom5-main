const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
require("dotenv").config();
const { Pool } = require("pg");
const { runMigrations } = require("../scripts/migrate");

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const migrationsDirectory = path.join(__dirname, "..", "data", "migrations");

test("CRM migrations upgrade a populated legacy schema without losing records", {
  skip: !databaseUrl,
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const schema = `crm_migration_${crypto.randomUUID().replace(/-/g, "")}`;
  const legacyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-crm-legacy-"));
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await fs.copyFile(
      path.join(migrationsDirectory, "001_customer_crm.sql"),
      path.join(legacyDirectory, "001_customer_crm.sql"),
    );
    await runMigrations(client, legacyDirectory);

    const activeCustomerId = crypto.randomUUID();
    const inactiveCustomerId = crypto.randomUUID();
    await client.query(
      `INSERT INTO customers
        (customer_id, full_name, phone, email, address, city, source, status, is_active)
       VALUES
        ($1, 'Active Legacy Customer', '+84901234567', 'active@example.com', 'Legacy address',
          'Hanoi', 'web', 'active', TRUE),
        ($2, 'Blocked Legacy Customer', '+84907654321', 'blocked@example.com', 'Old address',
          'Hue', 'web', 'blocked', TRUE)`,
      [activeCustomerId, inactiveCustomerId],
    );
    await client.query(
      `INSERT INTO customer_interactions (customer_id, type, note, created_by)
       VALUES ($1, 'chat', 'Keep this interaction', 'migration-test')`,
      [activeCustomerId],
    );
    await client.query(
      `INSERT INTO customer_orders
        (customer_id, order_id, order_no, total_amount, order_status)
       VALUES ($1, $2, 'legacy-order-1', 12345, 'pending')`,
      [activeCustomerId, crypto.randomUUID()],
    );

    await runMigrations(client, migrationsDirectory);
    await runMigrations(client, migrationsDirectory);

    const customers = await client.query(
      `SELECT customer_id, status, is_active, deleted_at, address, city
       FROM customers ORDER BY email`,
    );
    assert.equal(customers.rowCount, 2);
    assert.equal(customers.rows[0].customer_id, activeCustomerId);
    assert.equal(customers.rows[0].status, "customer");
    assert.equal(customers.rows[0].is_active, true);
    assert.equal(customers.rows[0].deleted_at, null);
    assert.equal(customers.rows[0].address, "Legacy address");
    assert.equal(customers.rows[0].city, "Hanoi");
    assert.equal(customers.rows[1].customer_id, inactiveCustomerId);
    assert.equal(customers.rows[1].is_active, false);
    assert.ok(customers.rows[1].deleted_at);

    await client.query(
      "UPDATE customers SET address = NULL, city = NULL WHERE customer_id = $1",
      [activeCustomerId],
    );
    await client.query(
      `INSERT INTO customers (full_name, phone, email, source)
       VALUES ('Replacement Customer', '+84901111111', 'blocked@example.com', 'api')`,
    );

    const relations = await client.query(
      `SELECT
         (SELECT count(*) FROM customer_interactions WHERE customer_id = $1)::int AS interactions,
         (SELECT order_status FROM customer_orders WHERE order_no = 'legacy-order-1') AS order_status`,
      [activeCustomerId],
    );
    assert.equal(relations.rows[0].interactions, 1);
    assert.equal(relations.rows[0].order_status, "received");
    const consent = await client.query(
      `INSERT INTO consent_records
        (customer_id, purpose, consent, policy_version, data_source, retention_days)
       VALUES ($1, 'order', TRUE, '1.0', 'api', 365)
       RETURNING id`,
      [activeCustomerId],
    );
    assert.ok(consent.rows[0].id);

    const foreignKeys = await client.query(
      `SELECT conname, confdeltype
       FROM pg_constraint
       WHERE conrelid IN (
         'customer_interactions'::regclass,
         'customer_orders'::regclass,
         'consent_records'::regclass
       )
         AND contype = 'f'`,
    );
    assert.equal(foreignKeys.rowCount, 3);
    assert.ok(foreignKeys.rows.every((row) => row.confdeltype === "r"));

    const history = await client.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(history.rows.map((row) => row.version), ["001", "002"]);

    await client.query(
      `INSERT INTO customers (full_name, phone, email, source)
       VALUES ('New CRM Customer', '+84901111111', 'new@example.com', 'api')`,
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    client.release();
    await pool.end();
    await fs.rm(legacyDirectory, { recursive: true, force: true });
  }
});
