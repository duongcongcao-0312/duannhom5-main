"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "endpoint-audit-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-endpoint-audit-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    addressesPath: path.join(directory, "addresses.json"),
    customersPath: path.join(directory, "customers.json"),
    customerInteractionsPath: path.join(directory, "customer-interactions.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    paymentWebhookSecret: "a".repeat(32),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("API endpoint audit verifies public, internal webhook, alternate paths, versioning, and cross-account isolation", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Public endpoints succeed without auth and expose no secrets
  for (const endpoint of [
    "/health",
    "/ready",
    "/api/v1/version",
    "/api/version",
    "/api/v1/books",
    "/api/books",
    "/api/v1/categories",
    "/api/v1/authors",
    "/api/v1/publishers",
    "/api/v1/policies/privacy",
    "/api/v1/policies/terms",
    "/api/v1/policies/shipping",
    "/api/v1/policies/return",
    "/api/v1/policies/refund",
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200, `Public endpoint ${endpoint} should return 200`);
    const body = await res.text();
    assert.doesNotMatch(body, /ADMIN_PASSWORD|SEPAY_API_KEY|passwordHash/i);
  }

  // 2. Register two users for cross-account & alternate-path verification
  const register = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: "audit-user-pass-123" }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await register("Audit User A", "audit-a@example.com");
  const userB = await register("Audit User B", "audit-b@example.com");

  const addrB = (await (await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
    body: JSON.stringify({ recipientName: "User B", phone: "0908123456", addressLine: "50 Đường Audit B, Quận 1" }),
  })).json()).address;

  const orderB = await (await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
    body: JSON.stringify({
      customerName: "User B",
      address: addrB.addressLine,
      addressId: addrB.id,
      phone: addrB.phone,
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  })).json();

  // 3. Internal payment webhooks reject unauthenticated & normal user callers (cannot bypass signature/apikey)
  for (const endpoint of ["/api/v1/payments/webhook", "/api/payments/webhook"]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userA.token}`,
      },
      body: JSON.stringify({ id: "evt-1", orderId: orderB.orderId, status: "succeeded", amount: orderB.total, currency: "VND", occurredAt: new Date().toISOString() }),
    });
    assert.ok([401, 503].includes(res.status), `${endpoint} must reject unsigned user call, got ${res.status}`);
  }

  for (const endpoint of ["/api/v1/payments/sepay-webhook", "/api/payments/sepay-webhook"]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userA.token}`,
      },
      body: JSON.stringify({ id: "sepay-1", transferAmount: orderB.total, transferType: "in" }),
    });
    assert.ok([401, 503].includes(res.status), `${endpoint} must reject non-apikey call, got ${res.status}`);
  }

  // 4. Alternate paths (/api/* vs /api/v1/*) enforce identical auth & ownership protections
  for (const [method, endpoint] of [
    ["GET", "/api/auth/me"],
    ["GET", "/api/v1/auth/me"],
    ["GET", "/api/orders"],
    ["GET", "/api/v1/orders"],
    ["GET", "/api/addresses"],
    ["GET", "/api/v1/addresses"],
    ["GET", "/api/privacy/consents"],
    ["GET", "/api/v1/privacy/consents"],
    ["GET", "/api/privacy/data-requests"],
    ["GET", "/api/v1/privacy/data-requests"],
    ["GET", "/api/privacy/exports"],
    ["GET", "/api/v1/privacy/exports"],
    ["GET", "/api/customers"],
    ["GET", "/api/v1/customers"],
    ["GET", "/api/admin/customers"],
    ["GET", "/api/v1/admin/customers"],
    ["GET", "/api/admin/orders"],
    ["GET", "/api/v1/admin/orders"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/v1/admin/users"],
  ]) {
    assert.equal((await fetch(`${baseUrl}${endpoint}`, { method })).status, 401, `Anonymous must get 401 on ${endpoint}`);
  }

  // Cross-account IDOR blocked identically on both legacy /api/* and canonical /api/v1/* paths
  for (const endpoint of [
    `/api/orders/${orderB.orderId}`,
    `/api/v1/orders/${orderB.orderId}`,
    `/api/orders/${orderB.orderId}/status`,
    `/api/v1/orders/${orderB.orderId}/status`,
    `/api/users/${userB.user.id}`,
    `/api/v1/users/${userB.user.id}`,
    `/api/addresses/${addrB.id}`,
    `/api/v1/addresses/${addrB.id}`,
    "/api/customers",
    "/api/v1/customers",
    "/api/admin/customers",
    "/api/v1/admin/customers",
    "/api/admin/audit",
    "/api/v1/admin/audit",
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    assert.equal(res.status, 403, `User A must get 403 on ${endpoint}`);
  }

  // 5. Unsupported API version, unknown admin routes, and path traversal fail closed
  assert.equal((await fetch(`${baseUrl}/api/v2/books`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/does-not-exist`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/does-not-exist`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    })).status,
    403,
  );
  const traversalRes = await fetch(`${baseUrl}/api/v1/users/%2e%2e/admin/users`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.ok([400, 403].includes(traversalRes.status), `Traversal attempt must be blocked (400/403), got ${traversalRes.status}`);

  // 6. Audit report document exists and covers all API endpoint groups
  const auditDoc = await fs.readFile(
    path.join(__dirname, "..", "docs", "api-endpoint-audit.md"),
    "utf8",
  );
  for (const section of [
    "/api/v1/books",
    "/api/v1/auth/me",
    "/api/v1/users/:id",
    "/api/v1/addresses/:id",
    "/api/v1/orders/:id",
    "/api/v1/privacy/exports/:id/download",
    "/api/v1/payments/webhook",
    "/api/v1/admin/audit",
    "/api/v1/(admin/)?customers",
  ]) {
    assert.ok(auditDoc.includes(section), `docs/api-endpoint-audit.md must document ${section}`);
  }
});
