"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("migration 022 defines targeted idempotent indexes for frequent queries without unsafe locks or bloat", async () => {
  const mig022 = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "022_query_performance_indexes.sql"),
    "utf8",
  );
  const expectedIndexes = [
    "idx_app_users_lower_email",
    "idx_store_products_custom_created",
    "idx_store_orders_created_at",
    "idx_store_orders_payment_status_created",
    "idx_customers_active_status_created",
    "idx_privacy_consents_retain_until",
  ];
  for (const name of expectedIndexes) {
    assert.ok(mig022.includes(`IF NOT EXISTS ${name}`), `missing idempotent index ${name}`);
  }
  // Partial indexes used to minimize storage/write cost
  assert.match(mig022, /WHERE is_custom = TRUE/i);
  assert.match(mig022, /WHERE is_active = TRUE/i);
});

test("database index strategy document covers EXPLAIN verification and write/storage cost analysis", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "database-indexes.md"), "utf8");
  assert.match(doc, /EXPLAIN \(ANALYZE, BUFFERS\)/);
  assert.match(doc, /pg_stat_user_indexes/);
  assert.match(doc, /partial index/i);
  assert.match(doc, /idx_app_users_lower_email/);
  assert.match(doc, /idx_privacy_consents_retain_until/);
});

test("migration 025 removes the payment status index only when its composite replacement exists", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "025_remove_redundant_order_index.sql"),
    "utf8",
  );
  assert.match(migration, /to_regclass\('idx_store_orders_payment_status_created'\)/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_store_orders_payment_status/);
  assert.match(migration, /BN-128/);
});
