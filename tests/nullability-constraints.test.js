"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

test("migration 021 backfills NULLs before enforcing NOT NULL and preserves intentional nullable fields", async () => {
  const migrationsDir = path.join(__dirname, "..", "data", "migrations");
  const mig005 = await fs.readFile(path.join(migrationsDir, "005_relational_store.sql"), "utf8");
  const mig021 = await fs.readFile(path.join(migrationsDir, "021_enforce_non_null_business_fields.sql"), "utf8");

  // Backfill UPDATE runs strictly before ALTER COLUMN ... SET NOT NULL
  const updateUsersIdx = mig021.indexOf("UPDATE app_users");
  const alterUsersNotNullIdx = mig021.indexOf("ALTER COLUMN email_verified SET NOT NULL");
  assert.ok(updateUsersIdx > 0 && alterUsersNotNullIdx > updateUsersIdx);

  const updateDueAtIdx = mig021.indexOf("UPDATE privacy_data_requests");
  const alterDueAtNotNullIdx = mig021.indexOf("ALTER COLUMN due_at SET NOT NULL");
  assert.ok(updateDueAtIdx > 0 && alterDueAtNotNullIdx > updateDueAtIdx);

  // Required text non-empty checks are present on orders and service requests
  assert.match(mig021, /store_orders_required_text_non_empty/);
  assert.match(mig021, /service_requests_required_text_non_empty/);

  // Intentional optional fields remain nullable (no SET NOT NULL on them)
  assert.match(mig005, /user_id TEXT REFERENCES app_users\(user_id\) ON DELETE SET NULL/);
  assert.match(mig005, /coupon_code VARCHAR\(64\),/);
  assert.doesNotMatch(mig021, /ALTER COLUMN user_id SET NOT NULL/i);
  assert.doesNotMatch(mig021, /ALTER COLUMN coupon_code SET NOT NULL/i);
  assert.doesNotMatch(mig021, /ALTER COLUMN assigned_to SET NOT NULL/i);
  assert.doesNotMatch(mig021, /ALTER COLUMN resolution_code SET NOT NULL/i);
});

test("API validation rejects null for required fields while allowing optional fields to remain null/omitted", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-null-"));
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

  // Required fields with null -> 400
  const nullRegister = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: null, email: "nullcheck@example.com", password: "Valid-Strong-Password!2026" }),
  });
  assert.equal(nullRegister.status, 400);

  const nullOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: null,
      address: "123 Street",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "a1".repeat(32),
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(nullOrder.status, 400);

  // Guest order with intentionally null/omitted userId and couponCode succeeds (201)
  const validGuestOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Guest Buyer",
      address: "123 Street",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "b2".repeat(32),
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(validGuestOrder.status, 201);
  const body = await validGuestOrder.json();
  assert.equal(body.couponCode ?? null, null);
});
