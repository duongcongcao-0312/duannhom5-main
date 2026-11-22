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
  process.env.ADMIN_PASSWORD = "order-idor-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-order-idor-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
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

test("order APIs prevent IDOR across accounts, guest orders, and all HTTP methods", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  const registerUser = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: "order-idor-user-pass-123" }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await registerUser("Order User A", "order-a@example.com");
  const userB = await registerUser("Order User B", "order-b@example.com");

  // User B creates an order
  const createOrderB = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      customerName: "Order User B",
      address: "55 Đường Riêng Tư B, Quận 1",
      phone: "0908222333",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(createOrderB.status, 201);
  const orderB = await createOrderB.json();

  // Guest creates a guest order with 256-bit access code
  const guestAccessCode = "e5".repeat(32);
  const createGuestOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Guest Buyer",
      address: "77 Đường Khách, Quận 2",
      phone: "0908444555",
      paymentMethod: "cod",
      accessCode: guestAccessCode,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(createGuestOrder.status, 201);
  const guestOrder = await createGuestOrder.json();

  // 1. Unauthenticated attacker with known orderB.orderId -> 401 on GET, status, PATCH, PUT, DELETE
  assert.equal((await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}/status`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}`, { method: "DELETE" })).status,
    401,
  );

  // 2. User A cannot list User B's orders or probe ?userId=
  const listA = await fetch(`${baseUrl}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(listA.status, 200);
  assert.deepEqual(await listA.json(), []);

  const probeListA = await fetch(`${baseUrl}/api/v1/orders?userId=${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(probeListA.status, 400);

  // 3. Cross-account IDOR: User A targeting User B's orderId across GET, status, PATCH, PUT, DELETE, admin PATCH -> 403
  for (const [method, endpoint, body] of [
    ["GET", `/api/v1/orders/${orderB.orderId}`],
    ["GET", `/api/v1/orders/${orderB.orderId}/status`],
    ["PATCH", `/api/v1/orders/${orderB.orderId}`, { status: "cancelled" }],
    ["PUT", `/api/v1/orders/${orderB.orderId}`, { status: "cancelled" }],
    ["DELETE", `/api/v1/orders/${orderB.orderId}`],
    ["PATCH", `/api/v1/admin/orders/${orderB.orderId}`, { status: "cancelled" }],
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${userA.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `User A must get 403 on ${method} ${endpoint}`);
  }

  // 4. Guest order IDOR: missing/wrong access code -> 404 on read; User A cannot PATCH/DELETE guest order -> 403
  assert.equal((await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`)).status, 404);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
      headers: { "X-Order-Access-Code": "00".repeat(32) },
    })).status,
    404,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    })).status,
    404,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userA.token}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
    })).status,
    403,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userA.token}` },
    })).status,
    403,
  );

  // Guest with valid access code CAN read status and public order (no PII)
  const validGuestLookup = await fetch(`${baseUrl}/api/v1/orders/${guestOrder.orderId}`, {
    headers: { "X-Order-Access-Code": guestAccessCode },
  });
  assert.equal(validGuestLookup.status, 200);
  assert.doesNotMatch(await validGuestLookup.text(), /77 Đường Khách|0908444555/);

  // 5. User B's order is untouched ("received") and User B can read & cancel their own order
  const checkB = await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}/status`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(checkB.status, 200);
  assert.equal((await checkB.json()).orderStatus, "received");

  const cancelB = await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelB.status, 200);
  assert.equal((await cancelB.json()).status, "cancelled");
});
