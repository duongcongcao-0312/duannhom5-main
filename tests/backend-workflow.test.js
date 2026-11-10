const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function configureTestAdmin(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "local-test-admin-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("backend APIs - coupons, auth, orders and admin workflow", async (t) => {
  configureTestAdmin(t);
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-backend-test-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const server = createServer({
    ordersPath,
    usersPath,
    servicesPath,
    corsOrigins: "https://shop.example",
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const preflight = await fetch(`${baseUrl}/api/orders`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://shop.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://shop.example");
  const rejectedPreflight = await fetch(`${baseUrl}/api/orders`, {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(rejectedPreflight.status, 403);

  // 1. Coupon API works
  const couponRes = await fetch(`${baseUrl}/api/coupons/BOOKNEST10`);
  assert.equal(couponRes.status, 200);
  const couponData = await couponRes.json();
  assert.equal(couponData.rate, 0.1);

  // 2. Auth: Admin login with explicitly configured credentials
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://shop.example",
    },
    body: JSON.stringify({ email: "admin@example.com", password: "local-test-admin-password-123" }),
  });
  assert.equal(adminLoginRes.status, 200);
  assert.equal(
    adminLoginRes.headers.get("access-control-allow-origin"),
    "https://shop.example",
  );
  assert.equal(
    adminLoginRes.headers.get("access-control-allow-credentials"),
    "true",
  );
  const adminData = await adminLoginRes.json();
  assert.ok(adminData.token);
  assert.equal(adminData.user.role, "admin");

  const adminToken = adminData.token;

  // 3. Auth: Register a regular user
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Trần Minh",
      email: "tranminh@example.com",
      password: "password12345",
      studentType: "student",
      studentId: "HS-9988",
    }),
  });
  assert.equal(registerRes.status, 201);
  const regData = await registerRes.json();
  assert.equal(regData.user.name, "Trần Minh");

  const duplicateRegisterRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Tên khác",
      email: " TRANMINH@example.com ",
      password: "password45678",
    }),
  });
  assert.equal(duplicateRegisterRes.status, 409);
  const duplicateError = (await duplicateRegisterRes.json()).error;
  assert.match(duplicateError, /không thể hoàn tất đăng ký/i);
  assert.doesNotMatch(duplicateError, /đã được đăng ký|email.*tồn tại/i);

  // 4. Auth: Profile lookup via token
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.email, "tranminh@example.com");

  // 5. Save customer information to the account
  const customerInfoRes = await fetch(`${baseUrl}/api/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regData.token}`,
    },
    body: JSON.stringify({
      customerName: "Trần Minh",
      phone: "0912345678",
      address: "123 Phố Sách Hà Nội",
    }),
  });
  assert.equal(customerInfoRes.status, 200);

  // 6. Place an order
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    // Student discounts are derived from the authenticated account, not the request body.
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regData.token}`,
    },
    body: JSON.stringify({
      customerName: "Trần Minh",
      address: "123 Phố Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderData = await orderRes.json();
  assert.equal(orderData.discount, 8900);
  assert.equal(orderData.total, 80100);

  // 7. Profile includes saved customer information
  const updatedMeRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` },
  });
  const updatedMe = await updatedMeRes.json();
  assert.equal(updatedMe.user.customerInfo.address, "123 Phố Sách Hà Nội");

  // 8. Admin: View orders
  const adminOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminOrdersRes.status, 200);
  const adminOrders = await adminOrdersRes.json();
  assert.ok(adminOrders.length >= 1);
  assert.equal(adminOrders[0].orderId, orderData.orderId);

  // 9. Admin: Update order status to 'processing'
  const patchOrderRes = await fetch(
    `${baseUrl}/api/admin/orders/${orderData.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "processing", paymentStatus: "paid" }),
    },
  );
  assert.equal(patchOrderRes.status, 200);
  const patchedOrder = await patchOrderRes.json();
  assert.equal(patchedOrder.status, "processing");
  assert.equal(patchedOrder.paymentStatus, "paid");

  // 10. Service request API
  const serviceRes = await fetch(`${baseUrl}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: "rent",
      bookTitle: "Đắc Nhân Tâm",
      condition: "new",
      name: "Lê Hoàng",
      phone: "0987654321",
      note: "Thuê trong 2 tuần",
    }),
  });
  assert.equal(serviceRes.status, 201);

  // 11. Admin Stats API
  const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalOrders >= 1);
  assert.ok(stats.totalUsers >= 2);
});

test("authenticated users cannot read or modify other users' orders", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-order-ownership-test-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const server = createServer({ ordersPath, usersPath, servicesPath });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const aliceRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Alice",
      email: "alice@example.com",
      password: "password12345",
    }),
  });
  assert.equal(aliceRegister.status, 201);
  const aliceToken = (await aliceRegister.json()).token;

  const bobRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Bob",
      email: "bob@example.com",
      password: "password12345",
    }),
  });
  assert.equal(bobRegister.status, 201);
  const bobToken = (await bobRegister.json()).token;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({
      customerName: "Alice",
      address: "123 Đường Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderId = (await orderRes.json()).orderId;

  const anonymousHistory = await fetch(`${baseUrl}/api/orders`);
  assert.equal(anonymousHistory.status, 401);

  const aliceHistory = await fetch(`${baseUrl}/api/orders`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.equal(aliceHistory.status, 200);
  assert.deepEqual((await aliceHistory.json()).map((order) => order.orderId), [orderId]);

  const bobHistory = await fetch(`${baseUrl}/api/orders`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(bobHistory.status, 200);
  assert.deepEqual(await bobHistory.json(), []);

  const bobView = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(bobView.status, 403);

  const bobPatch = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bobToken}`,
    },
    body: JSON.stringify({ status: "shipping" }),
  });
  assert.equal(bobPatch.status, 403);

  const aliceView = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.equal(aliceView.status, 200);

  const forbiddenPaymentUpdate = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({ status: "processing", paymentStatus: "paid" }),
  });
  assert.equal(forbiddenPaymentUpdate.status, 403);
  const alicePatch = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(alicePatch.status, 403);

  const aliceCancel = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `******
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(aliceCancel.status, 200);
  assert.equal((await aliceCancel.json()).status, "cancelled");
});

test("registration returns a JSON service error when user persistence is unavailable", async (t) => {
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.NODE_ENV = "production";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "secure-test-password-123";
  const server = createServer({
    database: {
      async getCustomBooks() {
        return [];
      },
      async createUser() {
        throw new Error("database connection unavailable");
      },
      async saveSessionRecord() {},
      async getSessionRecord() {
        return null;
      },
      async deleteSessionRecord() {
        return false;
      },
      async deleteUserSessionRecords() {
        return 0;
      },
      async pruneExpiredSessionRecords() {
        return 0;
      },
    },
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const requestId = "issue56-registration-failure";
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args.join(" "));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        name: "New Reader",
        email: "new-reader@example.com",
        password: "password12345",
      }),
    });
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("x-request-id"), requestId);
    const body = await response.json();
    assert.match(body.error, /không thể lưu tài khoản/i);
    assert.doesNotMatch(JSON.stringify(body), /database connection unavailable|stack/i);
    assert.ok(loggedErrors.some((line) =>
      line.includes(requestId) &&
      line.includes("POST") &&
      line.includes("/api/auth/register") &&
      line.includes("database connection unavailable"),
    ));
  } finally {
    console.error = originalConsoleError;
  }
});
