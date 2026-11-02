const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");
const { createServer } = require("../server");


test("customer management access is role-scoped and audit fields are recorded", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-rbac-test-"),
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
  const db = new Database({ usersPath, servicesPath, ordersPath });
  await db.createUser({
    name: "Nhân viên sales",
    email: "sales@example.com",
    password: "password123",
    role: "sales",
    createdBy: "admin@booknest.vn",
  });
  await db.createUser({
    name: "Khách hàng thường",
    email: "member@example.com",
    password: "password123",
    role: "user",
  });

  const salesLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales@example.com",
      password: "password123",
    }),
  });
  assert.equal(salesLoginRes.status, 200);
  const salesToken = (await salesLoginRes.json()).token;

  const salesOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${salesToken}` },
  });
  assert.equal(salesOrdersRes.status, 200);

  const salesUsersRes = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${salesToken}` },
  });
  assert.equal(salesUsersRes.status, 403);

  const userLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "member@example.com",
      password: "password123",
    }),
  });
  assert.equal(userLoginRes.status, 200);
  const memberToken = (await userLoginRes.json()).token;

  const memberStatsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert.equal(memberStatsRes.status, 403);

  const memberUnknownAdminPathRes = await fetch(`${baseUrl}/api/admin/secret`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert.equal(memberUnknownAdminPathRes.status, 403);

  const salesRecord = await db.findUserByEmail("sales@example.com");
  assert.equal(salesRecord.role, "sales");
  assert.equal(salesRecord.createdBy, "admin@booknest.vn");
  assert.ok(salesRecord.updatedAt);
});

test("customer management validation rejects invalid roles and duplicate users", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-user-validation-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const db = new Database({ usersPath, servicesPath, ordersPath });

  t.after(async () => {
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      db.createUser({
        name: "Bad role",
        email: "bad-role@example.com",
        password: "password123",
        role: "boss",
      }),
    /Vai trò người dùng không hợp lệ/,
  );

  await db.createUser({
    name: "Nguyễn Anh",
    email: "anh@example.com",
    password: "password123",
    role: "user",
  });

  await assert.rejects(
    () =>
      db.createUser({
        name: "Nguyễn Anh Lặp",
        email: "anh@example.com",
        password: "password456",
        role: "user",
      }),
    /Email này đã được đăng ký/,
  );

  const savedUser = await db.findUserByEmail("anh@example.com");
  assert.equal(savedUser.role, "user");
  assert.ok(savedUser.createdAt);
  assert.ok(savedUser.updatedAt);
});

test("CRM API completes create, filter, status progression, and soft delete lifecycle", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-crm-lifecycle-test-"),
  );
  const paths = {
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    customersPath: path.join(temporaryDirectory, "customers.json"),
  };
  const server = createServer(paths);
  const db = new Database(paths);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  await db.createUser({
    name: "CRM Admin",
    email: "crm-admin@example.com",
    password: "password123",
    role: "admin",
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "crm-admin@example.com",
      password: "password123",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const token = (await loginResponse.json()).token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const createResponse = await fetch(`${baseUrl}/api/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "CRM Lifecycle",
      email: "crm-lifecycle@example.com",
      phone: "0912345678",
    }),
  });
  assert.equal(createResponse.status, 201);
  const customer = await createResponse.json();
  assert.equal(customer.status, "new");
  const admin = await db.findUserByEmail("crm-admin@example.com");
  assert.equal(customer.created_by, admin.id);

  const filteredResponse = await fetch(
    `${baseUrl}/api/customers?search=lifecycle&status=new&page=1&limit=1`,
    { headers },
  );
  assert.equal(filteredResponse.status, 200);
  assert.equal((await filteredResponse.json()).length, 1);

  const invalidTransitionResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "customer" }),
    },
  );
  assert.equal(invalidTransitionResponse.status, 409);

  const transitionResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "lead" }),
    },
  );
  assert.equal(transitionResponse.status, 200);
  assert.equal((await transitionResponse.json()).status, "lead");

  const deleteResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    { method: "DELETE", headers },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });

  const deletedLookupResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    { headers },
  );
  assert.equal(deletedLookupResponse.status, 404);
  const remainingResponse = await fetch(`${baseUrl}/api/customers`, { headers });
  assert.equal(remainingResponse.status, 200);
  assert.equal((await remainingResponse.json()).length, 0);
});
