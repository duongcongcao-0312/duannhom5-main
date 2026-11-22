"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { getAdminPermission } = require("../backend/router");

const SAMPLE_UUID = "00000000-0000-4000-8000-000000000001";
const SAMPLE_UUID_2 = "00000000-0000-4000-8000-000000000002";

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "admin-protection-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-admin-guard-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    categoriesPath: path.join(directory, "categories.json"),
    authorsPath: path.join(directory, "authors.json"),
    publishersPath: path.join(directory, "publishers.json"),
    couponsPath: path.join(directory, "coupons.json"),
    customersPath: path.join(directory, "customers.json"),
    customerInteractionsPath: path.join(directory, "customer-interactions.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    uploadsDir: path.join(directory, "uploads"),
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

test("router permission matrix covers all admin routes, nested routes, aliases, and rejects disallowed methods", () => {
  assert.equal(getAdminPermission("/api/admin/stats", "GET"), "read:dashboard");
  assert.equal(getAdminPermission("/api/admin/stats", "POST"), null);
  assert.equal(getAdminPermission("/api/admin/monitoring", "GET"), "read:dashboard");
  assert.equal(getAdminPermission("/api/v1/admin/monitoring", "GET"), "read:dashboard");
  assert.equal(getAdminPermission("/api/admin/privacy/data-requests", "GET"), "read:privacy");
  assert.equal(getAdminPermission(`/api/admin/privacy/data-requests/${SAMPLE_UUID}`, "PATCH"), "write:privacy");
  assert.equal(getAdminPermission(`/api/admin/customers/${SAMPLE_UUID}`, "GET"), "read:customers");
  assert.equal(getAdminPermission(`/api/admin/customers/${SAMPLE_UUID}`, "PUT"), "write:customers");
  assert.equal(getAdminPermission(`/api/admin/customers/${SAMPLE_UUID}`, "PATCH"), "write:customers");
  assert.equal(getAdminPermission(`/api/admin/customers/${SAMPLE_UUID}`, "DELETE"), "delete:customers");
  assert.equal(
    getAdminPermission(`/api/v1/admin/customers/${SAMPLE_UUID}/interactions/${SAMPLE_UUID_2}`, "DELETE"),
    "delete:customers",
  );
});

test("all admin endpoints, nested routes, aliases, and alternate methods enforce 401/403 across Anonymous, User, Sales, Support, and Admin", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // Login admin
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "admin-protection-password-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const createStaff = async (email, role) => {
    const res = await fetch(`${baseUrl}/api/v1/admin/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: `Matrix ${role}`,
        email,
        password: `${role}-matrix-pass-123`,
        role,
      }),
    });
    assert.equal(res.status, 201);
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: `${role}-matrix-pass-123` }),
    });
    assert.equal(login.status, 200);
    return (await login.json()).token;
  };

  const salesToken = await createStaff("sales-matrix@booknest.vn", "sales");
  const supportToken = await createStaff("support-matrix@booknest.vn", "support");
  const userReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Matrix User",
      email: "user-matrix@example.com",
      password: "user-matrix-pass-123",
    }),
  });
  assert.equal(userReg.status, 201);
  const { token: userToken } = await userReg.json();

  // Seed one customer so nested interaction routes can be tested against real IDs
  const seedCustomer = await fetch(`${baseUrl}/api/v1/admin/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Protected Customer",
      email: "protected-cust@example.com",
      phone: "0901234567",
    }),
  });
  assert.equal(seedCustomer.status, 201);
  const { id: customerId } = await seedCustomer.json();

  const call = (method, endpoint, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  // Matrix of admin endpoints, aliases, and nested routes with allowed roles
  const matrix = [
    { method: "GET", path: "/api/v1/admin/stats", allowed: ["admin", "sales"] },
    { method: "GET", path: "/api/admin/stats", allowed: ["admin", "sales"] },
    { method: "GET", path: "/api/v1/admin/monitoring", allowed: ["admin", "sales"] },
    { method: "GET", path: "/api/v1/admin/orders", allowed: ["admin", "sales"] },
    { method: "GET", path: "/api/v1/admin/services", allowed: ["admin", "sales", "support"] },
    { method: "GET", path: "/api/v1/admin/books", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/categories", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/authors", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/publishers", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/coupons", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/users", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/staff", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/audit", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/privacy/data-requests", allowed: ["admin"] },
    { method: "GET", path: "/api/v1/admin/customers", allowed: ["admin", "sales", "support"] },
    { method: "GET", path: "/api/customers", allowed: ["admin", "sales", "support"] },
    { method: "GET", path: `/api/v1/admin/customers/${customerId}/interactions`, allowed: ["admin", "sales", "support"] },
    { method: "POST", path: "/api/v1/admin/customers", allowed: ["admin", "sales"], body: { name: "New", email: "new-c@example.com", phone: "0909998887" } },
    { method: "DELETE", path: `/api/v1/admin/customers/${customerId}`, allowed: ["admin"] },
    { method: "DELETE", path: `/api/customers/${customerId}/interactions/${SAMPLE_UUID}`, allowed: ["admin"] },
  ];

  const actors = [
    { role: "anonymous", token: null },
    { role: "user", token: userToken },
    { role: "support", token: supportToken },
    { role: "sales", token: salesToken },
    { role: "admin", token: adminToken },
  ];

  for (const entry of matrix) {
    for (const actor of actors) {
      // Skip actually deleting the seeded customer when admin runs so subsequent checks stay deterministic
      if (actor.role === "admin" && entry.method === "DELETE") continue;
      if (actor.role === "admin" && entry.method === "POST" && entry.path === "/api/v1/admin/customers") continue;

      const res = await call(entry.method, entry.path, actor.token, entry.body);
      if (actor.role === "anonymous") {
        assert.equal(res.status, 401, `Anonymous must get 401 on ${entry.method} ${entry.path}`);
      } else if (!entry.allowed.includes(actor.role)) {
        assert.equal(res.status, 403, `${actor.role} must get 403 on ${entry.method} ${entry.path}`);
      } else {
        assert.ok([200, 201].includes(res.status), `${actor.role} should succeed on ${entry.method} ${entry.path}, got ${res.status}`);
      }
    }
  }

  // Root /api/admin, unknown /api/admin/* paths, and disallowed HTTP methods fail closed
  for (const [method, endpoint] of [
    ["GET", "/api/admin"],
    ["GET", "/api/v1/admin"],
    ["GET", "/api/v1/admin/nonexistent"],
    ["POST", "/api/v1/admin/stats"],
    ["DELETE", "/api/v1/admin/users"],
    ["PUT", "/api/v1/admin/staff"],
  ]) {
    assert.equal((await call(method, endpoint, null)).status, 401, `Anonymous ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, userToken)).status, 403, `User ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, salesToken)).status, 403, `Sales ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, supportToken)).status, 403, `Support ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, adminToken)).status, 403, `Admin disallowed ${method} ${endpoint}`);
  }

  // X-HTTP-Method-Override cannot bypass method restrictions
  const overrideRes = await fetch(`${baseUrl}/api/v1/admin/audit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "X-HTTP-Method-Override": "GET",
    },
  });
  assert.equal(overrideRes.status, 405);
});
