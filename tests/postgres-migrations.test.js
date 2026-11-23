const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
require("dotenv").config();
const { Pool } = require("pg");
const { loadMigrationFiles, runMigrations } = require("../scripts/migrate");

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
    await client.query(`
      CREATE TABLE booknest_data (
        collection TEXT PRIMARY KEY,
        records JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
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
    const legacyOrderId = crypto.randomUUID();
    const legacyServiceId = crypto.randomUUID();
    await client.query(
      `INSERT INTO booknest_data (collection, records) VALUES
        ('users', $1::jsonb),
        ('customers', $2::jsonb),
        ('books', $3::jsonb),
        ('orders', $4::jsonb),
        ('services', $5::jsonb)`,
      [
        JSON.stringify([{
          id: "legacy-user-1", name: "Legacy User", email: "legacy-user@example.com",
          password: "hashed-password", role: "user", studentType: "other",
        }]),
        JSON.stringify([{
          id: crypto.randomUUID(), name: "Migrated Customer", phone: "+84909998877",
          email: "migrated-customer@example.com", status: "new", source: "web",
        }]),
        JSON.stringify([{
          id: "legacy-book-1", title: "Migrated Book", author: "Legacy Author",
          price: 1200, stock: 5, category: "van-hoc",
        }]),
        JSON.stringify([{
          orderId: legacyOrderId, userId: "legacy-user-1", customerName: "Legacy User",
          phone: "+84909990000", address: "Legacy address", paymentMethod: "cod",
          status: "received", paymentStatus: "cod_pending", subtotal: 2400,
          discount: 0, total: 2400, discountRate: 0, items: [{
            title: "Migrated Book", author: "Legacy Author", unitPrice: 1200,
            quantity: 2, lineTotal: 2400,
          }],
        }]),
        JSON.stringify([{
          id: legacyServiceId, service: "rent", bookTitle: "Migrated Book",
          condition: "good", name: "Legacy User", phone: "+84909990000",
          note: "", status: "pending",
        }]),
      ],
    );
    await client.query(`
      CREATE TABLE payment_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_hash TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      "INSERT INTO payment_webhook_events (event_id, event_hash) VALUES ('legacy-event', $1)",
      ["a".repeat(64)],
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
         (SELECT updated_by FROM customer_interactions WHERE customer_id = $1 LIMIT 1) AS interaction_updated_by,
         (SELECT updated_at FROM customer_interactions WHERE customer_id = $1 LIMIT 1) AS interaction_updated_at,
         (SELECT order_status FROM customer_orders WHERE order_no = 'legacy-order-1') AS order_status`,
      [activeCustomerId],
    );
    assert.equal(relations.rows[0].interactions, 1);
    assert.equal(relations.rows[0].interaction_updated_by, "migration-test");
    assert.ok(relations.rows[0].interaction_updated_at);
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

    const expectedMigrations = await loadMigrationFiles(migrationsDirectory);
    const history = await client.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(
      history.rows.map((row) => row.version),
      expectedMigrations.map((migration) => migration.version),
    );

    const idempotencyTable = await client.query(
      "SELECT to_regclass('order_idempotency') AS table_name",
    );
    assert.equal(idempotencyTable.rows[0].table_name, "order_idempotency");
    const inventoryTable = await client.query(
      "SELECT to_regclass('book_inventory') AS table_name",
    );
    assert.equal(inventoryTable.rows[0].table_name, "book_inventory");
    const accessCodeColumn = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'store_orders' AND column_name = 'access_code_hash'`,
    );
    assert.equal(accessCodeColumn.rowCount, 1);
    const inventory = await client.query(
      `INSERT INTO book_inventory (book_title, stock, reserved)
       VALUES ('Migrated Book', 5, 0) RETURNING book_title`,
    );
    assert.equal(inventory.rows[0].book_title, "Migrated Book");
    await assert.rejects(client.query(
      `INSERT INTO book_inventory (book_title, stock, reserved)
       VALUES ('Missing Product', 1, 0)`,
    ));

    const preservedPaymentEvent = await client.query(
      "SELECT event_id, order_id, amount, payment_status FROM payment_webhook_events WHERE event_id = 'legacy-event'",
    );
    assert.equal(preservedPaymentEvent.rowCount, 1);
    assert.equal(preservedPaymentEvent.rows[0].order_id, null);
    const paymentEvent = await client.query(
      `INSERT INTO payment_webhook_events
        (event_id, event_hash, order_id, amount, payment_status, occurred_at)
       VALUES ('migration-event', $1, $2, 2400, 'paid', NOW()) RETURNING event_id`,
      ["b".repeat(64), legacyOrderId],
    );
    assert.equal(paymentEvent.rows[0].event_id, "migration-event");
    await assert.rejects(client.query(
      `INSERT INTO payment_webhook_events
        (event_id, event_hash, order_id, amount, payment_status, occurred_at)
       VALUES ('invalid-payment', $1, $2, -1, 'paid', NOW())`,
      ["c".repeat(64), legacyOrderId],
    ));
    await assert.rejects(client.query(
      `INSERT INTO payment_webhook_events
        (event_id, event_hash, order_id, amount, payment_status, occurred_at)
       VALUES ('orphan-payment', $1, $2, 1, 'paid', NOW())`,
      ["d".repeat(64), crypto.randomUUID()],
    ));
    const relationalCounts = await client.query(`
      SELECT
        (SELECT count(*) FROM app_users WHERE user_id = 'legacy-user-1')::int AS users,
        (SELECT count(*) FROM customers WHERE email = 'migrated-customer@example.com')::int AS customers,
        (SELECT count(*) FROM store_products WHERE title = 'Migrated Book')::int AS products,
        (SELECT count(*) FROM store_orders WHERE order_id = $1)::int AS orders,
        (SELECT count(*) FROM store_order_items WHERE order_id = $1 AND line_total = 2400)::int AS items,
        (SELECT count(*) FROM service_requests WHERE service_id = $2)::int AS services
    `, [legacyOrderId, legacyServiceId]);
    assert.deepEqual(relationalCounts.rows[0], {
      users: 1, customers: 1, products: 1, orders: 1, items: 1, services: 1,
    });
    const relationalForeignKeys = await client.query(`
      SELECT conrelid::regclass::text AS table_name, confdeltype
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid IN (
          'store_orders'::regclass,
          'store_order_items'::regclass,
          'book_inventory'::regclass
        )
    `);
    assert.equal(relationalForeignKeys.rowCount, 4);
    assert.deepEqual(
      relationalForeignKeys.rows.map((row) => row.confdeltype).sort(),
      ["c", "c", "n", "r"],
    );

    await client.query(
      `INSERT INTO customers (full_name, phone, email, source)
       VALUES ('New CRM Customer', '+84901111111', 'new@example.com', 'api')`,
    );

    const dsar = await client.query(
      `INSERT INTO privacy_data_requests (subject_id, request_type, created_by)
       VALUES ('legacy-user-1', 'access', 'legacy-user-1')
       RETURNING request_id, subject_id`,
    );
    assert.equal(dsar.rows[0].subject_id, "legacy-user-1");
    await assert.rejects(client.query(
      `INSERT INTO privacy_data_requests (subject_id, request_type, created_by)
       VALUES ('non-existent-user-id', 'delete', 'non-existent-user-id')`,
    ));
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    client.release();
    await pool.end();
    await fs.rm(legacyDirectory, { recursive: true, force: true });
  }
});
