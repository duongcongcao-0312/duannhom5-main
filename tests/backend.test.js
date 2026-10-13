const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");
const { createServer } = require("../server");

test("backend APIs - coupons, auth, orders and admin workflow", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-backend-test-"));
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

  // 1. Coupon API works
  const couponRes = await fetch(`${baseUrl}/api/coupons/BOOKNEST10`);
  assert.equal(couponRes.status, 200);
  const couponData = await couponRes.json();
  assert.equal(couponData.rate, 0.1);

  // 2. Auth: Admin login with seeded default account
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" })
  });
  assert.equal(adminLoginRes.status, 200);
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
      studentId: "HS-9988"
    })
  });
  assert.equal(registerRes.status, 201);
  const regData = await registerRes.json();
  assert.equal(regData.user.name, "Trần Minh");

  // 4. Auth: Profile lookup via token
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.email, "tranminh@example.com");

  // 5. Place an order
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Trần Minh",
      address: "123 Phố Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0.1,
      items: [{ title: "Nhà giả kim", quantity: 1 }]
    })
  });
  assert.equal(orderRes.status, 201);
  const orderData = await orderRes.json();

  // 6. Admin: View orders
  const adminOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminOrdersRes.status, 200);
  const adminOrders = await adminOrdersRes.json();
  assert.ok(adminOrders.length >= 1);
  assert.equal(adminOrders[0].orderId, orderData.orderId);

  // 7. Admin: Update order status to 'processing'
  const patchOrderRes = await fetch(`${baseUrl}/api/admin/orders/${orderData.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ status: "processing", paymentStatus: "paid" })
  });
  assert.equal(patchOrderRes.status, 200);
  const patchedOrder = await patchOrderRes.json();
  assert.equal(patchedOrder.status, "processing");
  assert.equal(patchedOrder.paymentStatus, "paid");

  // 8. Service request API
  const serviceRes = await fetch(`${baseUrl}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: "rent",
      bookTitle: "Đắc Nhân Tâm",
      condition: "new",
      name: "Lê Hoàng",
      phone: "0987654321",
      note: "Thuê trong 2 tuần"
    })
  });
  assert.equal(serviceRes.status, 201);

  // 9. Admin Stats API
  const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalOrders >= 1);
  assert.ok(stats.totalUsers >= 2);
});

test("CRM customer model validates data, prevents active duplicates and preserves soft deletes", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-customers-model-"));
  const database = new Database({
    root: temporaryDirectory,
    usersPath: path.join(temporaryDirectory, "users.json"),
    customersPath: path.join(temporaryDirectory, "customers.json"),
  });
  t.after(() => fsPromises.rm(temporaryDirectory, { recursive: true, force: true }));

  const validCustomer = {
    name: "  Nguyễn An  ",
    email: "  Nguyen.An@example.com ",
    phone: "+84 (90) 123-4567",
  };
  await assert.rejects(
    database.createCustomer({ ...validCustomer, email: "not-an-email" }),
    /địa chỉ email hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, phone: "12345" }),
    /số điện thoại hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, phone: "090)1234567" }),
    /số điện thoại hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, name: " " }),
    /họ tên/,
  );

  const customer = await database.createCustomer(validCustomer);
  assert.equal(customer.name, "Nguyễn An");
  assert.equal(customer.email, "nguyen.an@example.com");
  assert.equal(customer.status, "new");
  await assert.rejects(
    database.createCustomer({ ...validCustomer, email: "NGUYEN.AN@EXAMPLE.COM" }),
    { status: 409 },
  );
  await assert.rejects(
    database.updateCustomerStatus(customer.id, "customer"),
    { status: 409 },
  );

  const lead = await database.updateCustomerStatus(customer.id, "lead");
  assert.equal(lead.status, "lead");
  const converted = await database.updateCustomerStatus(customer.id, "customer");
  assert.equal(converted.status, "customer");
  await assert.rejects(
    database.updateCustomerStatus(customer.id, "lead"),
    { status: 409 },
  );

  assert.equal(await database.softDeleteCustomer(customer.id), true);
  assert.deepEqual(await database.getCustomers(), []);
  const savedCustomers = JSON.parse(
    await fsPromises.readFile(path.join(temporaryDirectory, "customers.json"), "utf8"),
  );
  assert.ok(savedCustomers[0].deletedAt);
  assert.equal(await database.softDeleteCustomer(customer.id), false);
});

test("CRM customer API requires an admin and enforces validation and lifecycle rules", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-customers-api-"));
  const server = createServer({
    usersPath: path.join(temporaryDirectory, "users.json"),
    customersPath: path.join(temporaryDirectory, "customers.json"),
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

  const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/customers`);
  assert.equal(unauthorizedResponse.status, 403);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" }),
  });
  assert.equal(loginResponse.status, 200);
  const { token } = await loginResponse.json();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const invalidResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Nguyễn An", email: "invalid", phone: "0901234567" }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /email hợp lệ/);

  const createResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Nguyễn An",
      email: "nguyen.an@example.com",
      phone: "0901234567",
    }),
  });
  assert.equal(createResponse.status, 201);
  const customer = await createResponse.json();

  const duplicateResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Khách khác",
      email: "other@example.com",
      phone: "(090) 123-4567",
    }),
  });
  assert.equal(duplicateResponse.status, 409);

  const transitionResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "lead" }),
  });
  assert.equal(transitionResponse.status, 200);
  assert.equal((await transitionResponse.json()).status, "lead");

  const deleteResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
  const listResponse = await fetch(`${baseUrl}/api/admin/customers`, { headers });
  assert.deepEqual(await listResponse.json(), []);
});
