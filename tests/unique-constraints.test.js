"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");
const { createServer } = require("../server");

test("migration 023 cleans duplicates before adding unique indexes for email, order/payment code, and transaction ref", async () => {
  const mig023 = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "023_unique_identifiers_constraints.sql"),
    "utf8",
  );

  // Deduplication runs strictly BEFORE unique index creation
  assert.ok(mig023.indexOf("WITH ranked_customers") < mig023.indexOf("idx_customers_lower_email_active"));
  assert.ok(mig023.indexOf("WITH extracted_codes") < mig023.indexOf("idx_store_orders_payment_code_unique"));
  assert.ok(mig023.indexOf("WITH ranked_tx") < mig023.indexOf("idx_payment_webhook_events_tx_ref_unique"));

  for (const idx of [
    "idx_customers_lower_email_active",
    "idx_app_users_lower_email",
    "idx_store_orders_payment_code_unique",
    "idx_store_orders_idempotency_key_unique",
    "idx_payment_webhook_events_tx_ref_unique",
  ]) {
    assert.ok(mig023.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx}`), `missing ${idx}`);
  }
});

test("runtime rejects duplicate email (case-insensitive), duplicate order idempotency conflict, and duplicate payment transaction event", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-unique-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Duplicate email rejected with 409
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "First", email: "unique@example.com", password: "Unique-Strong-Password!2026" }),
    })).status,
    201,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Second", email: "UNIQUE@example.com", password: "Unique-Strong-Password!2026" }),
    })).status,
    409,
  );

  // 2. Duplicate order Idempotency-Key with mismatched payload rejected with 409
  const key = "unique-order-key-2026-0001";
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        customerName: "Order Owner",
        address: "123 Duong Sach, Quan 1",
        phone: "0901234567",
        paymentMethod: "cod",
        accessCode: "a1".repeat(32),
        items: [{ title: "Nhà giả kim", quantity: 1 }],
      }),
    })).status,
    201,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        customerName: "Order Owner",
        address: "123 Duong Sach, Quan 1",
        phone: "0901234567",
        paymentMethod: "cod",
        accessCode: "a1".repeat(32),
        items: [{ title: "Nhà giả kim", quantity: 2 }],
      }),
    })).status,
    409,
  );

  // 3. Duplicate payment webhook event_id in PostgreSQL is deduplicated/conflicted via ON CONFLICT DO NOTHING
  const seenEvents = new Map();
  const sampleOrderId = "00000000-0000-4000-8000-000000000077";
  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const text = String(sql);
          if (text.includes("INSERT INTO payment_webhook_events")) {
            if (seenEvents.has(params[0])) {
              return { rows: [], rowCount: 0 };
            }
            seenEvents.set(params[0], params[1]);
            return { rows: [{ event_id: params[0] }], rowCount: 1 };
          }
          if (text.includes("SELECT event_hash FROM payment_webhook_events")) {
            const hash = seenEvents.get(params[0]);
            return { rows: hash ? [{ event_hash: hash }] : [], rowCount: hash ? 1 : 0 };
          }
          if (text.includes("FROM store_orders")) {
            return {
              rows: [{
                order_id: sampleOrderId,
                customer_name: "Order Owner",
                phone: "0901234567",
                address: "123 Duong Sach, Quan 1",
                payment_method: "transfer",
                status: "received",
                payment_status: "pending",
                discount_rate: 0,
                subtotal: 100000,
                discount: 0,
                total: 100000,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                items: [{ title: "Nhà giả kim", author: "", unitPrice: 100000, quantity: 1, lineTotal: 100000 }],
              }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
  const pgDb = new PostgresDatabase({ pool });
  pgDb.initialization = Promise.resolve();
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const firstEvent = await pgDb.applyPaymentWebhookEvent({
    eventId: "tx-event-001",
    eventHash: hashA,
    orderId: sampleOrderId,
    paymentStatus: "paid",
    amount: 100000,
    occurredAt: new Date().toISOString(),
  });
  assert.equal(firstEvent.duplicate, false);

  const dupSameHash = await pgDb.applyPaymentWebhookEvent({
    eventId: "tx-event-001",
    eventHash: hashA,
    orderId: sampleOrderId,
    paymentStatus: "paid",
    amount: 100000,
    occurredAt: new Date().toISOString(),
  });
  assert.equal(dupSameHash.duplicate, true);
  assert.equal(dupSameHash.conflict, false);

  const dupConflictHash = await pgDb.applyPaymentWebhookEvent({
    eventId: "tx-event-001",
    eventHash: hashB,
    orderId: sampleOrderId,
    paymentStatus: "paid",
    amount: 100000,
    occurredAt: new Date().toISOString(),
  });
  assert.equal(dupConflictHash.conflict, true);
});
