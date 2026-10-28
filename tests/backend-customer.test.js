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
