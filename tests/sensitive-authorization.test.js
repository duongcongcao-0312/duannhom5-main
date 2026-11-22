"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  SENSITIVE_OPERATIONS_CATALOG,
  requireOwnershipOrPermission,
} = require("../backend/authorization");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "sensitive-authz-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-sensitive-authz-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    couponsPath: path.join(directory, "coupons.json"),
    customersPath: path.join(directory, "customers.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    uploadsDir: path.join(directory, "uploads"),
    paymentWebhookSecret: "a".repeat(48),
    sepayApiKey: "sepay-secret-key-for-authz-test-1234",
    sepayAccountNumber: "000012345678",
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

test("SENSITIVE_OPERATIONS_CATALOG covers all 7 domains and requireOwnershipOrPermission enforces auth & ownership", () => {
  for (const domain of [
    "account_data",
    "orders",
    "addresses",
    "pricing_coupons",
    "inventory",
    "payments",
    "administration",
  ]) {
    assert.ok(SENSITIVE_OPERATIONS_CATALOG[domain], `Missing domain: ${domain}`);
    assert.ok(SENSITIVE_OPERATIONS_CATALOG[domain].endpoints.length > 0);
  }

  class TestErr extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  assert.throws(
    () => requireOwnershipOrPermission(null, { ownerId: "u1", permission: "read:orders" }, TestErr),
    (err) => err.status === 401,
  );
  assert.throws(
    () => requireOwnershipOrPermission({ userId: "u2", role: "user" }, { ownerId: "u1", permission: "read:orders" }, TestErr),
    (err) => err.status === 403,
  );
  assert.equal(
    requireOwnershipOrPermission({ userId: "u1", role: "user" }, { ownerId: "u1", permission: "read:orders" }, TestErr).userId,
    "u1",
  );
  assert.equal(
    requireOwnershipOrPermission({ userId: "s1", role: "sales" }, { ownerId: "u1", permission: "read:orders" }, TestErr).userId,
    "s1",
  );
});

test("direct API calls cannot bypass backend authorization across account, orders, addresses, pricing, inventory, payments, and admin", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // Login admin and provision sales + support staff + 2 regular buyers
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "sensitive-authz-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const createStaff = async (email, role) => {
    const createRes = await fetch(`${baseUrl}/api/v1/admin/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: `Staff ${role}`,
        email,
        password: `${role}-staff-password-123`,
        role,
      }),
    });
    assert.equal(createRes.status, 201);
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: `${role}-staff-password-123` }),
    });
    assert.equal(loginRes.status, 200);
    return (await loginRes.json()).token;
  };

  const registerBuyer = async (email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Buyer Account",
        email,
        password: "buyer-password-123",
      }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).token;
  };

  const salesToken = await createStaff("sales-authz@booknest.vn", "sales");
  const supportToken = await createStaff("support-authz@booknest.vn", "support");
  const buyer1Token = await registerBuyer("buyer1-authz@example.com");
  const buyer2Token = await registerBuyer("buyer2-authz@example.com");

  // 1. Account data & addresses: unauthenticated -> 401; client privilege escalation -> 403
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/me`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v1/privacy/exports`)).status, 401);

  const escalateRoleRes = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${buyer1Token}`,
    },
    body: JSON.stringify({ role: "admin" }),
  });
  assert.equal(escalateRoleRes.status, 403);

  // 2. Orders & addresses + 3. Server-side pricing (tampered price/discount/total ignored)
  const createBuyerOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${buyer1Token}`,
    },
    body: JSON.stringify({
      customerName: "Buyer One",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      discountRate: 0.1, // spoofed student discount — buyer is not verified
      subtotal: 1,
      discount: 1,
      total: 0,
      items: [{ title: "Nhà giả kim", quantity: 1, price: 1, lineTotal: 1 }],
    }),
  });
  assert.equal(createBuyerOrder.status, 201);
  const buyer1Order = await createBuyerOrder.json();
  assert.ok(buyer1Order.total > 1000, "Server must ignore client-supplied price/total");
  assert.equal(
    buyer1Order.discount,
    Math.round(buyer1Order.subtotal * 0.05),
    "Server must ignore spoofed 10% student discountRate and apply only verified member rate",
  );

  // Unauthenticated lookup of user order -> 401
  assert.equal((await fetch(`${baseUrl}/api/v1/orders/${buyer1Order.orderId}`)).status, 401);
  // Cross-user lookup & update -> 403
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${buyer1Order.orderId}`, {
      headers: { Authorization: `Bearer ${buyer2Token}` },
    })).status,
    403,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${buyer1Order.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyer2Token}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
    })).status,
    403,
  );

  // Buyer attempting to self-approve/complete own order -> 403
  for (const forbiddenBody of [
    { status: "completed" },
    { status: "shipping" },
    { paymentStatus: "paid" },
    { items: [{ title: "Nhà giả kim", quantity: 2 }] },
  ]) {
    const res = await fetch(`${baseUrl}/api/v1/orders/${buyer1Order.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyer1Token}`,
      },
      body: JSON.stringify(forbiddenBody),
    });
    assert.equal(res.status, 403, `Buyer must not perform ${JSON.stringify(forbiddenBody)}`);
  }

  // Support staff (no write:orders) cannot self-complete or modify items on their own order -> 403
  const supportOrderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supportToken}`,
    },
    body: JSON.stringify({
      customerName: "Support Buyer",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234568",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(supportOrderRes.status, 201);
  const supportOrder = await supportOrderRes.json();
  for (const forbiddenBody of [
    { status: "completed" },
    { paymentStatus: "paid" },
    { items: [{ title: "Nhà giả kim", quantity: 2 }] },
  ]) {
    const res = await fetch(`${baseUrl}/api/v1/orders/${supportOrder.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supportToken}`,
      },
      body: JSON.stringify(forbiddenBody),
    });
    assert.equal(res.status, 403, `Support must not perform ${JSON.stringify(forbiddenBody)}`);
  }

  // 4. Inventory & pricing/coupons: non-admin roles blocked (403)
  for (const [token, roleName] of [[buyer1Token, "user"], [salesToken, "sales"], [supportToken, "support"]]) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/admin/books`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Unauthorized Book", price: 50000 }),
      })).status,
      403,
      `${roleName} cannot create books`,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/admin/coupons`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: "HACK30",
          label: "Hack",
          rate: 0.3,
          minSubtotal: 0,
          maxUses: 100,
          startsAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
          enabled: true,
        }),
      })).status,
      403,
      `${roleName} cannot create coupons`,
    );
  }

  // 5. Payments: webhooks reject missing/invalid HMAC & SePay API key (401); support/user cannot update admin paymentStatus (403)
  const badSepay = await fetch(`${baseUrl}/api/v1/payments/sepay-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Apikey wrong-key",
    },
    body: JSON.stringify({ id: "tx-1", transferAmount: 100000, transferType: "in" }),
  });
  assert.equal(badSepay.status, 401);

  for (const token of [buyer1Token, supportToken]) {
    const res = await fetch(`${baseUrl}/api/v1/admin/orders/${buyer1Order.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentStatus: "paid" }),
    });
    assert.equal(res.status, 403);
  }

  // 6. Administration & CRM & Audit: least-privilege enforcement
  for (const [token, roleName] of [[buyer1Token, "user"], [salesToken, "sales"], [supportToken, "support"]]) {
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/audit`, { headers })).status, 403, `${roleName} cannot read audit`);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/staff`, { headers })).status, 403, `${roleName} cannot read staff`);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/users`, { headers })).status, 403, `${roleName} cannot read users`);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/privacy/data-requests`, { headers })).status, 403, `${roleName} cannot read admin DSAR`);
  }
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/customers`, { headers: { Authorization: `Bearer ${buyer1Token}` } })).status,
    403,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/stats`, { headers: { Authorization: `Bearer ${supportToken}` } })).status,
    403,
  );
});
