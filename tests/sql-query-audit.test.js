"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");

function createSpyPool(handler) {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return handler(String(sql), params, queries.length);
    },
    async connect() {
      return {
        query: pool.query,
        release() {},
      };
    },
    async end() {},
  };
  return { pool, queries };
}

test("order list read uses a single LEFT JOIN LATERAL query without N+1 queries for representative dataset", async () => {
  const representativeRows = Array.from({ length: 100 }, (_, i) => ({
    order_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    user_id: `user-${i}`,
    customer_name: `Customer ${i}`,
    phone: "0901234567",
    address: "123 Book St",
    payment_method: "cod",
    status: "received",
    payment_status: "cod_pending",
    discount_rate: 0,
    subtotal: 200000,
    discount: 0,
    total: 200000,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    items: [
      { title: `Book A-${i}`, author: "Author A", unitPrice: 100000, quantity: 1, lineTotal: 100000 },
      { title: `Book B-${i}`, author: "Author B", unitPrice: 100000, quantity: 1, lineTotal: 100000 },
    ],
  }));

  const { pool, queries } = createSpyPool(() => ({ rows: representativeRows, rowCount: representativeRows.length }));
  const db = new PostgresDatabase({ pool });
  db.initialization = Promise.resolve();

  const orders = await db.readRelationalCollection(pool, "orders");
  assert.equal(orders.length, 100);
  assert.equal(orders[0].items.length, 2);
  assert.equal(queries.length, 1, "reading 100 orders with items must execute exactly 1 SQL query");
  assert.match(queries[0].sql, /LEFT JOIN LATERAL/i);
  assert.match(queries[0].sql, /json_agg/i);
});

test("writeRelationalCollection batches order items with UNNEST instead of N+1 per-item inserts", async () => {
  const { pool, queries } = createSpyPool(() => ({ rows: [], rowCount: 1 }));
  const db = new PostgresDatabase({ pool });
  db.initialization = Promise.resolve();

  const items = Array.from({ length: 25 }, (_, i) => ({
    title: `Book Title ${i + 1}`,
    author: `Author ${i + 1}`,
    unitPrice: 50000,
    quantity: 2,
  }));
  const order = {
    orderId: "00000000-0000-4000-8000-000000000001",
    customerName: "Batch Buyer",
    phone: "0901234567",
    address: "456 Batch Rd",
    paymentMethod: "cod",
    status: "received",
    paymentStatus: "cod_pending",
    subtotal: 2500000,
    discount: 0,
    total: 2500000,
    items,
  };

  await db.writeRelationalCollection(pool, "orders", [order]);

  // 1 store_products UNNEST batch + 1 store_orders upsert + 1 delete items + 1 store_order_items UNNEST batch + 1 prune
  assert.equal(queries.length, 5, `expected 5 batched queries for 25 items, got ${queries.length}`);
  const productBatch = queries.find((q) => /INSERT INTO store_products/i.test(q.sql));
  const itemBatch = queries.find((q) => /INSERT INTO store_order_items/i.test(q.sql));
  assert.match(productBatch.sql, /UNNEST\(\$1::text\[\]/i);
  assert.equal(productBatch.params[1].length, 25);
  assert.match(itemBatch.sql, /UNNEST\(\$2::text\[\]/i);
  assert.equal(itemBatch.params[1].length, 25);
});

test("findUserByEmail and findUserById use direct parameterized WHERE LIMIT 1 lookups", async () => {
  const sampleRow = {
    user_id: "u-42",
    email: "lookup@example.com",
    full_name: "Lookup User",
    password_hash: "scrypt$N=16384,r=8,p=1$abcd$ef01",
    role: "user",
    student_type: "other",
    student_id: "",
    customer_info: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { pool, queries } = createSpyPool(() => ({ rows: [sampleRow], rowCount: 1 }));
  const db = new PostgresDatabase({ pool });
  db.initialization = Promise.resolve();

  const byEmail = await db.findUserByEmail("  LOOKUP@Example.COM ");
  assert.equal(byEmail.id, "u-42");
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE lower\(email\) = \$1 LIMIT 1/i);
  assert.deepEqual(queries[0].params, ["lookup@example.com"]);

  const byId = await db.findUserById("u-42");
  assert.equal(byId.email, "lookup@example.com");
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /WHERE user_id = \$1 LIMIT 1/i);
  assert.deepEqual(queries[1].params, ["u-42"]);
});

test("PostgresDatabase SQL queries parameterize user values and only interpolate static allowlisted identifiers", async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "backend", "postgres-db.js"), "utf8");
  // Ensure no direct string concatenation with SQL keywords like `WHERE ... ' +`
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^\n;]*\+\s*(?:email|id|name|phone|query|search|status|code|token)/i);
  assert.match(source, /FROM UNNEST\(\$1::text\[\]/i);
  assert.match(source, /WHERE lower\(email\) = \$1 LIMIT 1/i);
});
