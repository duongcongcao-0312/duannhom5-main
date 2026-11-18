const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runMigrations } = require("../scripts/migrate");

test("database migrations run in numeric order once and record each version", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-migrations-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, "010_later.sql"), "SELECT 'later';"),
    fs.writeFile(path.join(directory, "002_earlier.sql"), "SELECT 'earlier';"),
    fs.writeFile(path.join(directory, "README.md"), "not a migration"),
  ]);

  const applied = new Set();
  const statements = [];
  const client = {
    async query(sql, values = []) {
      statements.push(sql);
      if (sql.includes("SELECT 1 FROM schema_migrations")) {
        return { rowCount: applied.has(values[0]) ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO schema_migrations")) {
        applied.add(values[0]);
      }
      return { rowCount: 0 };
    },
  };

  await runMigrations(client, directory);
  assert.deepEqual(
    statements.filter((sql) => sql.startsWith("SELECT '")),
    ["SELECT 'earlier';", "SELECT 'later';"],
  );
  assert.deepEqual([...applied], ["002", "010"]);

  statements.length = 0;
  await runMigrations(client, directory);
  assert.equal(statements.some((sql) => sql.startsWith("SELECT '")), false);
  assert.equal(statements.filter((sql) => sql === "BEGIN").length, 2);
});

test("database migration failure rolls back the version and releases the migration lock", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-migration-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "001_broken.sql"), "SELECT 'broken';");
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === "SELECT 'broken';") throw new Error("migration failed");
      return { rowCount: 0 };
    },
  };

  await assert.rejects(runMigrations(client, directory), /migration failed/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(statements.some((sql) => sql.includes("pg_advisory_unlock")));
});

test("payment reconciliation migration stores verified transaction details and links inventory", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "013_payment_reconciliation_and_inventory_fk.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_webhook_events/);
  assert.match(migration, /event_id TEXT PRIMARY KEY/);
  assert.match(migration, /FOREIGN KEY \(order_id\) REFERENCES store_orders\(order_id\) ON DELETE RESTRICT/);
  assert.match(migration, /CHECK \(amount IS NULL OR amount >= 0\)/);
  assert.match(migration, /ALTER TABLE book_inventory/);
  assert.match(migration, /FOREIGN KEY \(book_title\) REFERENCES store_products\(title\) ON DELETE CASCADE/);
});

test("privacy data request migration enforces ownership, status, audit, and active-request uniqueness", async () => {
  const migrationPath = path.join(
    __dirname,
    "..",
    "data",
    "migrations",
    "014_privacy_data_requests.sql",
  );
  await assert.doesNotReject(fs.access(migrationPath));
  const migration = await fs.readFile(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS privacy_data_requests/);
  assert.match(migration, /FOREIGN KEY \(subject_id\) REFERENCES app_users\(user_id\) ON DELETE RESTRICT/);
  assert.match(migration, /request_type IN \('access', 'update', 'delete'\)/);
  assert.match(migration, /status IN \('pending', 'processing', 'completed', 'rejected'\)/);
  assert.match(migration, /created_by TEXT NOT NULL/);
  assert.match(migration, /updated_by TEXT/);
  assert.match(migration, /ON privacy_data_requests \(subject_id, request_type\)/);
});

test("shared rate-limit migration stores keyed bucket identifiers and indexes expiry", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "015_shared_rate_limits.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE shared_rate_limits/);
  assert.match(migration, /bucket_key TEXT PRIMARY KEY CHECK \(bucket_key ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(migration, /count INTEGER NOT NULL CHECK \(count > 0\)/);
  assert.match(migration, /CREATE INDEX idx_shared_rate_limits_expires_at/);
});

test("guest order migration stores only a validated access-code hash", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "016_guest_order_access_codes.sql"),
    "utf8",
  );
  assert.match(migration, /ALTER TABLE store_orders/);
  assert.match(migration, /ADD COLUMN access_code_hash TEXT/);
  assert.match(migration, /access_code_hash IS NULL OR access_code_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
});
