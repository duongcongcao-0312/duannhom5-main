"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { INTEGRITY_QUERIES } = require("../backend/migration-integrity");

test("every CREATE TABLE across all migrations declares a PRIMARY KEY", async () => {
  const migrationsDir = path.join(__dirname, "..", "data", "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  let tableCount = 0;

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const tableBlocks = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+[a-z0-9_]+\s*\([\s\S]*?\);/gi) || [];
    for (const block of tableBlocks) {
      tableCount += 1;
      assert.match(block, /PRIMARY KEY/i, `CREATE TABLE in ${file} is missing PRIMARY KEY:\n${block}`);
    }
  }
  assert.ok(tableCount >= 12, `expected at least 12 CREATE TABLE blocks, found ${tableCount}`);
});

test("migration 024 cleans orphan references before adding foreign keys and preserves order data", async () => {
  const mig024 = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "024_primary_foreign_keys_hardening.sql"),
    "utf8",
  );
  assert.ok(mig024.indexOf("DELETE FROM auth_sessions") < mig024.indexOf("fk_auth_sessions_user"));
  assert.ok(mig024.indexOf("UPDATE store_orders o") < mig024.indexOf("fk_store_orders_coupon_code"));
  assert.match(mig024, /fk_auth_sessions_user/);
  assert.match(mig024, /fk_store_orders_coupon_code/);
  assert.match(mig024, /fk_customer_orders_store_order/);
  assert.doesNotMatch(mig024, /DELETE FROM store_orders/i, "migration must never delete orders");
});

test("orphan integrity checks and full PK/FK schema inventory document are present", async () => {
  const checkNames = INTEGRITY_QUERIES.map((q) => q.name);
  assert.ok(checkNames.includes("orphaned_order_items"));
  assert.ok(checkNames.includes("orphaned_customer_interactions"));
  assert.ok(checkNames.includes("orphaned_order_users"));

  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "database-keys-inventory.md"), "utf8");
  for (const fk of [
    "fk_auth_sessions_user",
    "fk_store_orders_coupon_code",
    "fk_customer_orders_store_order",
    "fk_payment_webhook_events_order",
    "fk_book_inventory_product",
  ]) {
    assert.ok(doc.includes(fk), `inventory doc must list ${fk}`);
  }
});
