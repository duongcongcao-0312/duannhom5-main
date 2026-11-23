"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { loadMigrationFiles, runMigrations } = require("../scripts/migrate");

const migrationsDir = path.join(__dirname, "..", "data", "migrations");
const auditReportPath = path.join(__dirname, "..", "docs", "migration-audit-report.md");

test("all migrations have strictly sequential versions starting at 001 with balanced syntax blocks", async () => {
  const migrations = await loadMigrationFiles(migrationsDir);
  assert.ok(migrations.length >= 16, "expected at least the 16 base migrations");

  migrations.forEach((migration, index) => {
    const expectedNumber = index + 1;
    assert.equal(
      migration.numericVersion,
      expectedNumber,
      `expected sequential version ${expectedNumber} but found ${migration.filename}`,
    );

    if (migration.isNoop) return;

    // Strip single-quoted string literals and SQL comments before checking parentheses balance.
    const stripped = migration.sql
      .replace(/--[^\n]*/g, "")
      .replace(/'(?:''|[^'])*'/g, "''");

    let depth = 0;
    for (const ch of stripped) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      assert.ok(depth >= 0, `unmatched ')' in ${migration.filename}`);
    }
    assert.equal(depth, 0, `unbalanced parentheses in ${migration.filename}`);

    const dollarQuotes = (stripped.match(/\$\$/g) || []).length;
    assert.equal(
      dollarQuotes % 2,
      0,
      `unbalanced $$ dollar-quoted block in ${migration.filename}`,
    );
  });
});

test("foreign keys referencing app_users(user_id) use compatible TEXT column types (regression for 014)", async () => {
  const mig005 = await fs.readFile(path.join(migrationsDir, "005_relational_store.sql"), "utf8");
  assert.match(mig005, /CREATE TABLE IF NOT EXISTS app_users\s*\([\s\S]*?user_id\s+TEXT\s+PRIMARY KEY/i);

  const mig014 = await fs.readFile(path.join(migrationsDir, "014_privacy_data_requests.sql"), "utf8");
  assert.match(mig014, /subject_id\s+TEXT\s+NOT NULL/i);
  assert.doesNotMatch(
    mig014,
    /subject_id\s+UUID\b/i,
    "014_privacy_data_requests.sql must not declare subject_id as UUID while referencing app_users(user_id TEXT)",
  );
  assert.match(
    mig014,
    /FOREIGN KEY\s*\(subject_id\)\s+REFERENCES\s+app_users\s*\(user_id\)/i,
  );
});

test("all 16 base migrations use idempotent DDL and align fk_book_inventory_product behavior", async () => {
  const migrations = await loadMigrationFiles(migrationsDir);
  const firstSixteen = migrations.filter((m) => m.numericVersion <= 16);
  assert.equal(firstSixteen.length, 16);

  for (const migration of firstSixteen) {
    if (migration.isNoop) continue;
    // Every CREATE TABLE must use IF NOT EXISTS.
    const createTableMatches = [...migration.sql.matchAll(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)(\w+)/gi)];
    assert.deepEqual(
      createTableMatches.map((m) => m[1]),
      [],
      `${migration.filename} has CREATE TABLE without IF NOT EXISTS`,
    );
  }

  // 005 and 013 must both use guarded fk_book_inventory_product with ON DELETE CASCADE.
  const mig005 = await fs.readFile(path.join(migrationsDir, "005_relational_store.sql"), "utf8");
  const mig013 = await fs.readFile(
    path.join(migrationsDir, "013_payment_reconciliation_and_inventory_fk.sql"),
    "utf8",
  );
  assert.match(mig005, /IF NOT EXISTS\s*\([\s\S]*?fk_book_inventory_product/i);
  assert.match(
    mig005,
    /FOREIGN KEY\s*\(book_title\)\s+REFERENCES\s+store_products\s*\(title\)\s+ON DELETE CASCADE/i,
  );
  assert.match(
    mig013,
    /FOREIGN KEY\s*\(book_title\)\s+REFERENCES\s+store_products\s*\(title\)\s+ON DELETE CASCADE/i,
  );

  // 015 and 016 must be idempotent.
  const mig015 = await fs.readFile(path.join(migrationsDir, "015_shared_rate_limits.sql"), "utf8");
  assert.match(mig015, /CREATE TABLE IF NOT EXISTS shared_rate_limits/i);
  assert.match(mig015, /CREATE INDEX IF NOT EXISTS idx_shared_rate_limits_expires_at/i);

  const mig016 = await fs.readFile(path.join(migrationsDir, "016_guest_order_access_codes.sql"), "utf8");
  assert.match(mig016, /ADD COLUMN IF NOT EXISTS access_code_hash TEXT/i);
});

test("table dependencies are satisfied in migration order (CREATE TABLE precedes ALTER TABLE and REFERENCES)", async () => {
  const migrations = await loadMigrationFiles(migrationsDir);
  const knownTables = new Set();

  for (const migration of migrations) {
    if (migration.isNoop) continue;

    // Collect tables created in this migration first (self-references or alter in same file are valid).
    for (const match of migration.sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      knownTables.add(match[1].toLowerCase());
    }

    for (const match of migration.sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      const table = match[1].toLowerCase();
      assert.ok(
        knownTables.has(table),
        `${migration.filename} alters table '${table}' before it is created`,
      );
    }

    for (const match of migration.sql.matchAll(/REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const table = match[1].toLowerCase();
      assert.ok(
        knownTables.has(table),
        `${migration.filename} references table '${table}' before it is created`,
      );
    }
  }
});

test("runMigrations executes the entire repository migration chain cleanly and skips on idempotent re-run", async () => {
  const migrations = await loadMigrationFiles(migrationsDir);
  const applied = new Map();
  let executedSqlCount = 0;

  const client = {
    async query(sql, values = []) {
      const text = String(sql).trim();
      if (text.startsWith("SELECT 1 FROM schema_migrations")) {
        return { rowCount: applied.has(values[0]) ? 1 : 0, rows: [] };
      }
      if (text.startsWith("SELECT checksum FROM schema_migrations")) {
        const record = applied.get(values[0]);
        return { rowCount: record ? 1 : 0, rows: record ? [{ checksum: record.checksum }] : [] };
      }
      if (text.startsWith("INSERT INTO schema_migrations")) {
        applied.set(values[0], { filename: values[1], checksum: values[2] });
        return { rowCount: 1, rows: [] };
      }
      if (
        !text.startsWith("SELECT pg_advisory_") &&
        !text.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations") &&
        !text.startsWith("ALTER TABLE schema_migrations") &&
        text !== "BEGIN" &&
        text !== "COMMIT" &&
        text !== "ROLLBACK"
      ) {
        executedSqlCount += 1;
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const firstRun = await runMigrations(client, migrationsDir);
  const expectedNonNoopCount = migrations.filter((m) => !m.isNoop).length;
  assert.equal(firstRun.applied.length, migrations.length);
  assert.equal(firstRun.skipped.length, 0);
  assert.equal(executedSqlCount, expectedNonNoopCount);

  executedSqlCount = 0;
  const secondRun = await runMigrations(client, migrationsDir);
  assert.equal(secondRun.applied.length, 0);
  assert.equal(secondRun.skipped.length, migrations.length);
  assert.equal(executedSqlCount, 0);
});

test("migration audit report documents all 16 base migrations and resolved defects", async () => {
  const doc = await fs.readFile(auditReportPath, "utf8");
  for (let i = 1; i <= 16; i += 1) {
    const version = String(i).padStart(3, "0");
    assert.ok(doc.includes(`\`${version}\``), `audit report should document migration ${version}`);
  }
  assert.match(doc, /014_privacy_data_requests\.sql/);
  assert.match(doc, /fk_book_inventory_product/);
  assert.match(doc, /015_shared_rate_limits\.sql/);
  assert.match(doc, /016_guest_order_access_codes\.sql/);
});
