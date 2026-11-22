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
  process.env.ADMIN_PASSWORD = "trust-boundary-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-trust-boundary-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    couponsPath: path.join(directory, "coupons.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
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

test("client-supplied userId and role are rejected and cannot forge identity or privileges", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Registering with spoofed role/userId -> rejected with 400
  for (const extra of [{ role: "admin" }, { userId: "00000000-0000-4000-8000-000000000001" }]) {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Spoofed User",
        email: "spoof@example.com",
        password: "spoof-password-123",
        ...extra,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "VALIDATION_ERROR");
  }

  // Register legitimate user
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Legit Buyer",
      email: "legit-buyer@example.com",
      password: "legit-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: userToken, user } = await regRes.json();
  assert.equal(user.role, "user");

  // 2. Spoofing userId/role in orders, services, privacy requests, and profile update -> rejected
  const spoofedOrderUser = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      userId: "00000000-0000-4000-8000-000000000099",
      customerName: "Legit Buyer",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(spoofedOrderUser.status, 400);
  assert.equal((await spoofedOrderUser.json()).code, "VALIDATION_ERROR");

  const spoofedServiceUser = await fetch(`${baseUrl}/api/v1/services`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      userId: "00000000-0000-4000-8000-000000000099",
      role: "admin",
      service: "rent",
      bookTitle: "Nhà giả kim",
      name: "Legit Buyer",
      phone: "0901234567",
    }),
  });
  assert.equal(spoofedServiceUser.status, 400);

  const spoofedConsent = await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      userId: "00000000-0000-4000-8000-000000000099",
      purpose: "order",
      policyVersion: "2026-01",
      consent: true,
      retentionDays: 365,
    }),
  });
  assert.equal(spoofedConsent.status, 400);

  // Admin cannot even create another admin via staff endpoint (only sales/support)
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "trust-boundary-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const staffAdminRole = await fetch(`${baseUrl}/api/v1/admin/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Fake Admin",
      email: "fake-admin@booknest.vn",
      password: "fake-admin-password-123",
      role: "admin",
    }),
  });
  assert.equal(staffAdminRole.status, 400);
});

test("client-supplied price, discountRate, total, and totalAmount are rejected or recalculated strictly from server catalog", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. totalAmount field is strictly rejected on quote & order creation
  const quoteWithTotalAmount = await fetch(`${baseUrl}/api/v1/orders/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      totalAmount: 1,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(quoteWithTotalAmount.status, 400);
  assert.equal((await quoteWithTotalAmount.json()).code, "VALIDATION_ERROR");

  const orderWithTotalAmount = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Guest Tamper",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "c3".repeat(32),
      totalAmount: 1,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderWithTotalAmount.status, 400);
  assert.equal((await orderWithTotalAmount.json()).code, "VALIDATION_ERROR");

  // 2. Guest quote & order with tampered price, subtotal, discount, total, and discountRate
  const serverQuoteRes = await fetch(`${baseUrl}/api/v1/orders/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      discountRate: 0.1, // guest is NOT eligible for student/member discount
      items: [{ title: "Nhà giả kim", quantity: 2 }],
    }),
  });
  assert.equal(serverQuoteRes.status, 200);
  const serverQuote = await serverQuoteRes.json();
  assert.equal(serverQuote.discountRate, 0);
  assert.equal(serverQuote.discount, 0);
  assert.equal(serverQuote.total, serverQuote.subtotal);
  assert.ok(serverQuote.subtotal > 100000);

  const guestOrderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Guest Tamper",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "d4".repeat(32),
      discountRate: 0.1,
      subtotal: 10,
      discount: 9,
      total: 1,
      items: [{ title: "Nhà giả kim", quantity: 2, price: 5, lineTotal: 10 }],
    }),
  });
  assert.equal(guestOrderRes.status, 201);
  const guestOrder = await guestOrderRes.json();
  assert.equal(guestOrder.subtotal, serverQuote.subtotal);
  assert.equal(guestOrder.discount, 0);
  assert.equal(guestOrder.total, serverQuote.total);
  assert.equal(guestOrder.items[0].lineTotal, serverQuote.items[0].lineTotal);

  // 3. Admin order item update rejects tampered price/totalAmount and recalculates from catalog
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "trust-boundary-admin-pass-123",
    }),
  });
  const { token: adminToken } = await adminLogin.json();

  const tamperedUpdate = await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      totalAmount: 1,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(tamperedUpdate.status, 400);

  const validUpdate = await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(validUpdate.status, 200);
  const updatedOrder = await validUpdate.json();
  assert.equal(updatedOrder.total, serverQuote.items[0].unitPrice);
});
