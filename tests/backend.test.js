const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hashPassword } = require("../backend/auth");
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

  // 5. Save customer information to the account
  const customerInfoRes = await fetch(`${baseUrl}/api/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regData.token}`
    },
    body: JSON.stringify({
      customerName: "Trần Minh",
      phone: "0912345678",
      address: "123 Phố Sách Hà Nội"
    })
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
      items: [{ title: "Nhà giả kim", quantity: 1 }]
    })
  });
  assert.equal(orderRes.status, 201);
  const orderData = await orderRes.json();

  // 7. Profile includes saved customer information
  const updatedMeRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` }
  });
  const updatedMe = await updatedMeRes.json();
  assert.equal(updatedMe.user.customerInfo.address, "123 Phố Sách Hà Nội");

  // 8. Admin: View orders
  const adminOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminOrdersRes.status, 200);
  const adminOrders = await adminOrdersRes.json();
  assert.ok(adminOrders.length >= 1);
  assert.equal(adminOrders[0].orderId, orderData.orderId);

  // 9. Admin: Update order status to 'processing'
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
      note: "Thuê trong 2 tuần"
    })
  });
  assert.equal(serviceRes.status, 201);

  // 11. Admin Stats API
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
    database.createCustomer({ ...validCustomer, email: "not-an-email" }, "sales-1"),
    /địa chỉ email hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, phone: "12345" }, "sales-1"),
    /số điện thoại hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, phone: "090)1234567" }, "sales-1"),
    /số điện thoại hợp lệ/,
  );
  await assert.rejects(
    database.createCustomer({ ...validCustomer, name: " " }, "sales-1"),
    /họ tên/,
  );

  const customer = await database.createCustomer(validCustomer, "sales-1");
  assert.equal(customer.name, "Nguyễn An");
  assert.equal(customer.email, "nguyen.an@example.com");
  assert.equal(customer.status, "new");
  assert.equal(customer.created_by, "sales-1");
  assert.equal(customer.updated_by, "sales-1");
  await assert.rejects(
    database.createCustomer({ ...validCustomer, email: "NGUYEN.AN@EXAMPLE.COM" }, "sales-1"),
    { status: 409 },
  );
  await assert.rejects(
    database.updateCustomerStatus(customer.id, "customer", "sales-1"),
    { status: 409 },
  );

  const lead = await database.updateCustomerStatus(customer.id, "lead", "sales-2");
  assert.equal(lead.status, "lead");
  assert.equal(lead.updated_by, "sales-2");
  const converted = await database.updateCustomerStatus(customer.id, "customer", "admin-1");
  assert.equal(converted.status, "customer");
  assert.equal(converted.updated_by, "admin-1");
  await assert.rejects(
    database.updateCustomerStatus(customer.id, "lead", "sales-1"),
    { status: 409 },
  );

  assert.equal(await database.softDeleteCustomer(customer.id, "admin-1"), true);
  assert.deepEqual(await database.getCustomers(), []);
  const savedCustomers = JSON.parse(
    await fsPromises.readFile(path.join(temporaryDirectory, "customers.json"), "utf8"),
  );
  assert.ok(savedCustomers[0].deletedAt);
  assert.equal(savedCustomers[0].updated_by, "admin-1");
  assert.equal(await database.softDeleteCustomer(customer.id, "admin-1"), false);
  await assert.rejects(
    database.createCustomer(validCustomer),
    { status: 401 },
  );
});

test("CRM customer API enforces roles, validation, lifecycle rules and audit fields", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-customers-api-"));
  const usersPath = path.join(temporaryDirectory, "users.json");
  const staff = [
    { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    { id: "sales-1", name: "Sales", email: "sales@example.com", role: "sales" },
    { id: "support-1", name: "Support", email: "support@example.com", role: "support" },
    { id: "user-1", name: "User", email: "user@example.com", role: "user" },
  ].map((user) => ({
    ...user,
    password: hashPassword("password123"),
    studentType: "other",
    studentId: "",
    createdAt: new Date().toISOString(),
  }));
  await fsPromises.writeFile(usersPath, JSON.stringify(staff), "utf8");
  const server = createServer({
    usersPath,
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

  async function headersFor(role) {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${role}@example.com`, password: "password123" }),
    });
    assert.equal(loginResponse.status, 200);
    const { token } = await loginResponse.json();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  const adminHeaders = await headersFor("admin");
  const salesHeaders = await headersFor("sales");
  const supportHeaders = await headersFor("support");
  const userHeaders = await headersFor("user");

  const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/customers`);
  assert.equal(unauthorizedResponse.status, 403);
  const regularUserResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    headers: userHeaders,
  });
  assert.equal(regularUserResponse.status, 403);
  const supportWriteResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers: supportHeaders,
    body: JSON.stringify({
      name: "Nguyễn An",
      email: "nguyen.an@example.com",
      phone: "0901234567",
    }),
  });
  assert.equal(supportWriteResponse.status, 403);

  const supportRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Staff",
      email: "new-staff@example.com",
      password: "password123",
      role: "admin",
    }),
  });
  assert.equal(supportRegistration.status, 201);
  assert.equal((await supportRegistration.json()).user.role, "user");

  const invalidResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers: salesHeaders,
    body: JSON.stringify({ name: "Nguyễn An", email: "invalid", phone: "0901234567" }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /email hợp lệ/);

  const createResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers: salesHeaders,
    body: JSON.stringify({
      name: "Nguyễn An",
      email: "nguyen.an@example.com",
      phone: "0901234567",
    }),
  });
  assert.equal(createResponse.status, 201);
  const customer = await createResponse.json();
  assert.equal(customer.created_by, "sales-1");
  assert.equal(customer.updated_by, "sales-1");

  const supportListResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    headers: supportHeaders,
  });
  assert.equal(supportListResponse.status, 200);
  assert.equal((await supportListResponse.json())[0].id, customer.id);

  const supportUpdateResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "PATCH",
    headers: supportHeaders,
    body: JSON.stringify({ status: "lead" }),
  });
  assert.equal(supportUpdateResponse.status, 403);
  const supportDeleteResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "DELETE",
    headers: supportHeaders,
  });
  assert.equal(supportDeleteResponse.status, 403);

  const duplicateResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    method: "POST",
    headers: salesHeaders,
    body: JSON.stringify({
      name: "Khách khác",
      email: "other@example.com",
      phone: "(090) 123-4567",
    }),
  });
  assert.equal(duplicateResponse.status, 409);

  const transitionResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "PATCH",
    headers: salesHeaders,
    body: JSON.stringify({ status: "lead" }),
  });
  assert.equal(transitionResponse.status, 200);
  const updatedCustomer = await transitionResponse.json();
  assert.equal(updatedCustomer.status, "lead");
  assert.equal(updatedCustomer.updated_by, "sales-1");

  const salesDeleteResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "DELETE",
    headers: salesHeaders,
  });
  assert.equal(salesDeleteResponse.status, 403);

  const deleteResponse = await fetch(`${baseUrl}/api/admin/customers/${customer.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
  const savedCustomers = JSON.parse(
    await fsPromises.readFile(path.join(temporaryDirectory, "customers.json"), "utf8"),
  );
  assert.equal(savedCustomers[0].updated_by, "admin-1");
  assert.ok(savedCustomers[0].deletedAt);
  const listResponse = await fetch(`${baseUrl}/api/admin/customers`, {
    headers: adminHeaders,
  });
  assert.deepEqual(await listResponse.json(), []);
});

test("customer management API exposes CRUD endpoints with validation and permissions", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-customer-api-"));
  const usersPath = path.join(temporaryDirectory, "users.json");
  const customersPath = path.join(temporaryDirectory, "customers.json");
  const staff = [
    { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    { id: "sales-1", name: "Sales", email: "sales@example.com", role: "sales" },
    { id: "support-1", name: "Support", email: "support@example.com", role: "support" },
    { id: "user-1", name: "User", email: "user@example.com", role: "user" },
  ].map((user) => ({
    ...user,
    password: hashPassword("password123"),
    studentType: "other",
    studentId: "",
    createdAt: new Date().toISOString(),
  }));
  await fsPromises.writeFile(usersPath, JSON.stringify(staff), "utf8");

  const server = createServer({ usersPath, customersPath });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function headersFor(role) {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${role}@example.com`, password: "password123" }),
    });
    assert.equal(loginResponse.status, 200);
    const { token } = await loginResponse.json();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  const salesHeaders = await headersFor("sales");
  const supportHeaders = await headersFor("support");
  const userHeaders = await headersFor("user");

  const anonymousListResponse = await fetch(`${baseUrl}/api/customers`);
  assert.equal(anonymousListResponse.status, 403);

  const noAccessResponse = await fetch(`${baseUrl}/api/customers`, {
    headers: userHeaders,
  });
  assert.equal(noAccessResponse.status, 403);

  const invalidResponse = await fetch(`${baseUrl}/api/customers`, {
    method: "POST",
    headers: salesHeaders,
    body: JSON.stringify({ name: "A", email: "bad-email", phone: "0901234567" }),
  });
  assert.equal(invalidResponse.status, 400);

  const createdResponse = await fetch(`${baseUrl}/api/customers`, {
    method: "POST",
    headers: salesHeaders,
    body: JSON.stringify({
      name: "Nguyễn An",
      email: "nguyen.an@example.com",
      phone: "+84 901 234 567",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const customer = await createdResponse.json();
  assert.equal(customer.email, "nguyen.an@example.com");
  assert.equal(customer.status, "new");

  const listResponse = await fetch(`${baseUrl}/api/customers?status=new&search=nguyen&page=1&limit=10`, {
    headers: supportHeaders,
  });
  assert.equal(listResponse.status, 200);
  const listData = await listResponse.json();
  assert.ok(Array.isArray(listData));
  assert.ok(listData.some((item) => item.id === customer.id));

  const detailResponse = await fetch(`${baseUrl}/api/customers/${customer.id}`, {
    headers: supportHeaders,
  });
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).id, customer.id);

  const updateResponse = await fetch(`${baseUrl}/api/customers/${customer.id}`, {
    method: "PUT",
    headers: salesHeaders,
    body: JSON.stringify({
      name: "Nguyễn An",
      email: "nguyen.an@example.com",
      phone: "0901234567",
      status: "lead",
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.status, "lead");

  const deleteResponse = await fetch(`${baseUrl}/api/customers/${customer.id}`, {
    method: "DELETE",
    headers: supportHeaders,
  });
  assert.equal(deleteResponse.status, 403);

  const adminDeleteResponse = await fetch(`${baseUrl}/api/customers/${customer.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${(await headersFor("admin")).Authorization.replace(/^Bearer\s+/i, "")}` },
  });
  assert.equal(adminDeleteResponse.status, 200);
});

test("backend rejects invalid service and status payloads", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-invalid-payloads-"));
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

  const invalidServiceRes = await fetch(`${baseUrl}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: "unknown",
      bookTitle: "Đắc Nhân Tâm",
      condition: "new",
      name: "Lê Hoàng",
      phone: "0987654321",
      note: "Thuê trong 2 tuần"
    })
  });
  assert.equal(invalidServiceRes.status, 400);

  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" })
  });
  assert.equal(adminLoginRes.status, 200);
  const adminToken = (await adminLoginRes.json()).token;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      discountRate: 0.05,
      items: [{ title: "Nhà giả kim", quantity: 1 }]
    })
  });
  assert.equal(orderRes.status, 201);
  const order = await orderRes.json();

  const invalidStatusRes = await fetch(`${baseUrl}/api/admin/orders/${order.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ status: "not-a-real-status", paymentStatus: "paid" })
  });
  assert.equal(invalidStatusRes.status, 400);
});
