const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");


test("backend APIs - coupons, auth, orders and admin workflow", async (t) => {
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

  // 2. Auth: Admin login with seeded default account
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://shop.example",
    },
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" }),
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
      password: "password123",
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
      password: "password456",
    }),
  });
  assert.equal(duplicateRegisterRes.status, 409);
  assert.match((await duplicateRegisterRes.json()).error, /đã được đăng ký/i);

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Trần Minh",
      address: "123 Phố Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0.1,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderData = await orderRes.json();

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

test("registration returns a JSON service error when user persistence is unavailable", async (t) => {
  const server = createServer({
    database: {
      async getCustomBooks() {
        return [];
      },
      async createUser() {
        throw new Error("database connection unavailable");
      },
    },
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Reader",
      email: "new-reader@example.com",
      password: "password123",
    }),
  });
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.match((await response.json()).error, /không thể lưu tài khoản/i);
});
