"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INTEGRITY_QUERIES,
  REQUIRED_SCHEMA_TABLES,
  assertPostMigrationIntegrity,
  listExpectedMigrationVersions,
  verifyPostMigrationIntegrity,
} = require("../backend/migration-integrity");

function createMockClient({
  appliedVersions,
  tables = REQUIRED_SCHEMA_TABLES,
  counts = {
    app_users: 5,
    store_products: 20,
    store_orders: 12,
    store_order_items: 25,
    customers: 8,
    customer_interactions: 15,
  },
  violationCounts = {},
} = {}) {
  return {
    async query(sql) {
      const normalized = String(sql);
      if (normalized.includes("FROM schema_migrations")) {
        return { rows: appliedVersions.map((version) => ({ version })) };
      }
      if (normalized.includes("FROM information_schema.tables")) {
        return { rows: tables.map((table_name) => ({ table_name })) };
      }
      if (normalized.includes("AS app_users")) {
        return { rows: [counts] };
      }
      for (const check of INTEGRITY_QUERIES) {
        if (normalized.trim() === check.sql.trim()) {
          return { rows: [{ count: Number(violationCounts[check.name] || 0) }] };
        }
      }
      throw new Error(`Unexpected SQL in mock client: ${normalized}`);
    },
  };
}

test("post-migration integrity passes when all migrations are applied, tables exist, and zero violations occur", async () => {
  const expectedVersions = await listExpectedMigrationVersions();
  assert.ok(expectedVersions.length >= 1);

  const client = createMockClient({ appliedVersions: expectedVersions });
  const report = await assertPostMigrationIntegrity(client);
  assert.equal(report.ok, true);
  assert.deepEqual(report.pendingMigrations, []);
  assert.deepEqual(report.missingTables, []);
  assert.deepEqual(report.violations, []);
  assert.equal(report.counts.store_orders, 12);
});

test("post-migration integrity fails clearly when migrations are incomplete or required tables are missing", async () => {
  const expectedVersions = await listExpectedMigrationVersions();
  const incompleteVersions = expectedVersions.slice(0, -1);

  const client = createMockClient({
    appliedVersions: incompleteVersions,
    tables: REQUIRED_SCHEMA_TABLES.filter((t) => t !== "store_order_items"),
  });

  await assert.rejects(
    () => assertPostMigrationIntegrity(client),
    (error) => {
      assert.equal(error.code, "POST_MIGRATION_INTEGRITY_FAILED");
      assert.match(error.message, /pending_migrations/);
      assert.match(error.message, /missing_required_tables/);
      assert.match(error.message, /store_order_items/);
      return true;
    },
  );
});

test("post-migration integrity detects orphaned records, missing items, duplicate emails, and invalid totals", async () => {
  const expectedVersions = await listExpectedMigrationVersions();
  const client = createMockClient({
    appliedVersions: expectedVersions,
    violationCounts: {
      orphaned_order_items: 3,
      orphaned_customer_interactions: 2,
      orders_without_items: 1,
      duplicate_user_emails: 1,
      invalid_order_totals: 4,
      negative_product_prices_or_stock: 2,
    },
  });

  const report = await verifyPostMigrationIntegrity(client);
  assert.equal(report.ok, false);
  const checkNames = report.violations.map((v) => v.check);
  assert.ok(checkNames.includes("orphaned_order_items"));
  assert.ok(checkNames.includes("orphaned_customer_interactions"));
  assert.ok(checkNames.includes("orders_without_items"));
  assert.ok(checkNames.includes("duplicate_user_emails"));
  assert.ok(checkNames.includes("invalid_order_totals"));
  assert.ok(checkNames.includes("negative_product_prices_or_stock"));

  await assert.rejects(
    () => assertPostMigrationIntegrity(client),
    /orphaned_order_items.*orphaned_customer_interactions/s,
  );
});
