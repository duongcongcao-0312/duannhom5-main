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
  process.env.ADMIN_PASSWORD = "admin-perm-secret-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-admin-perms-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    categoriesPath: path.join(directory, "categories.json"),
    authorsPath: path.join(directory, "authors.json"),
    publishersPath: path.join(directory, "publishers.json"),
    couponsPath: path.join(directory, "coupons.json"),
    addressesPath: path.join(directory, "addresses.json"),
    customersPath: path.join(directory, "customers.json"),
    customerInteractionsPath: path.join(directory, "customer-interactions.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    uploadsDir: path.join(directory, "uploads"),
    socialTokenVerifier: async () => ({
      email: "admin@booknest.vn",
      name: "Spoofed Admin Social",
      provider: "google",
      uid: "google-admin-spoof-1",
      emailVerified: true,
    }),
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

test("Admin role comes strictly from server-side provisioning; frontend headers, payloads, and social login cannot claim or escalate to Admin", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Register normal user (cannot inject role: "admin")
  const badReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Role": "admin", "X-Admin": "true" },
    body: JSON.stringify({
      name: "Fake Admin",
      email: "fake-admin@example.com",
      password: "user-secret-pass-123",
      role: "admin",
    }),
  });
  assert.equal(badReg.status, 400);

  const userReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Role": "admin" },
    body: JSON.stringify({
      name: "Regular User",
      email: "regular-admin-check@example.com",
      password: "user-secret-pass-123",
    }),
  });
  assert.equal(userReg.status, 201);
  const regularUser = await userReg.json();
  assert.equal(regularUser.user.role, "user");

  // 2. Spoofed frontend headers cannot grant admin access to unauthenticated or non-admin callers
  const spoofedHeaders = {
    "X-Role": "admin",
    "X-User-Role": "admin",
    "X-Admin": "true",
    "X-Forwarded-User": "admin@booknest.vn",
  };
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/users`, { headers: spoofedHeaders })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { ...spoofedHeaders, Authorization: "Bearer forged-admin-token" },
    })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { ...spoofedHeaders, Authorization: `Bearer ${regularUser.token}` },
    })).status,
    403,
  );

  // 3. Social login is explicitly forbidden for Admin accounts
  const adminSocialLogin = await fetch(`${baseUrl}/api/v1/auth/social`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-firebase-token",
    },
    body: JSON.stringify({ email: "admin@booknest.vn" }),
  });
  assert.ok([401, 403].includes(adminSocialLogin.status));
  const socialBody = await adminSocialLogin.json();
  assert.equal(socialBody.token, undefined);

  // 4. Valid Admin login succeeds via server-provisioned credentials and cannot mint another admin via /admin/staff
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "admin-perm-secret-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken, user: adminUser } = await adminLogin.json();
  assert.equal(adminUser.role, "admin");

  const mintAdmin = await fetch(`${baseUrl}/api/v1/admin/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Second Admin",
      email: "second-admin@booknest.vn",
      password: "second-admin-pass-123",
      role: "admin",
    }),
  });
  assert.equal(mintAdmin.status, 400);
});

test("Only valid Admin can perform Admin-only management actions; Anonymous gets 401 and User/Support/Sales get 403", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // Login Admin
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "admin-perm-secret-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  // Provision Sales and Support staff + register User
  const provisionStaff = async (email, role) => {
    const created = await fetch(`${baseUrl}/api/v1/admin/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: `Staff ${role}`,
        email,
        password: `${role}-staff-pass-123`,
        role,
      }),
    });
    assert.equal(created.status, 201);
    const staff = await created.json();
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: `${role}-staff-pass-123` }),
    });
    assert.equal(login.status, 200);
    return { staff, token: (await login.json()).token };
  };

  const sales = await provisionStaff("sales-admin-test@booknest.vn", "sales");
  const support = await provisionStaff("support-admin-test@booknest.vn", "support");

  const userReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Student Buyer",
      email: "student-admin-test@example.com",
      password: "student-pass-12345",
      studentType: "university",
      studentId: "SV2026001",
    }),
  });
  assert.equal(userReg.status, 201);
  const customer = await userReg.json();

  // Seed order, DSAR, and CRM customer
  const orderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({
      customerName: "Student Buyer",
      address: "10 Đường Đại Học, Quận 1",
      phone: "0905556667",
      paymentMethod: "transfer",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = await orderRes.json();

  const dsarRes = await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({ type: "access", channel: "web_portal" }),
  });
  assert.equal(dsarRes.status, 201);
  const { request: dsar } = await dsarRes.json();

  const crmRes = await fetch(`${baseUrl}/api/v1/admin/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "CRM Delete Target",
      email: "crm-del@example.com",
      phone: "0905777888",
    }),
  });
  assert.equal(crmRes.status, 201);
  const crmCustomer = await crmRes.json();

  const call = (method, endpoint, token, body) =>
    fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // 1. Admin-only endpoints reject Anonymous (401) and User/Support/Sales (403)
  const adminOnlyActions = [
    ["GET", "/api/v1/admin/books"],
    ["POST", "/api/v1/admin/books", {
      title: "Admin Approved Book",
      author: "Tác giả A",
      category: "van-hoc",
      price: 120000,
      stock: 15,
    }],
    ["GET", "/api/v1/admin/coupons"],
    ["POST", "/api/v1/admin/coupons", {
      code: "ADMIN10",
      label: "Admin Coupon",
      rate: 0.1,
      minSubtotal: 50000,
      maxUses: 10,
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      enabled: true,
    }],
    ["PATCH", `/api/v1/admin/orders/${order.orderId}`, { paymentStatus: "paid" }],
    ["GET", "/api/v1/admin/users"],
    ["PATCH", `/api/v1/admin/users/${customer.user.id}`, { studentVerificationStatus: "verified" }],
    ["GET", "/api/v1/admin/staff"],
    ["GET", "/api/v1/admin/audit"],
    ["GET", "/api/v1/admin/privacy/data-requests"],
    ["PATCH", `/api/v1/admin/privacy/data-requests/${dsar.id}`, { status: "processing" }],
    ["DELETE", `/api/v1/admin/customers/${crmCustomer.id}`],
  ];

  for (const [method, endpoint, body] of adminOnlyActions) {
    assert.equal((await call(method, endpoint, null, body)).status, 401, `Anonymous must get 401 on ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, customer.token, body)).status, 403, `User must get 403 on ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, support.token, body)).status, 403, `Support must get 403 on ${method} ${endpoint}`);
    assert.equal((await call(method, endpoint, sales.token, body)).status, 403, `Sales must get 403 on ${method} ${endpoint}`);
  }

  // 2. Valid Admin succeeds on all approved Admin-only actions
  for (const [method, endpoint, body] of adminOnlyActions) {
    const res = await call(method, endpoint, adminToken, body);
    assert.ok(
      [200, 201].includes(res.status),
      `Valid Admin must succeed on ${method} ${endpoint}, got ${res.status}`,
    );
  }

  // 3. Admin deactivating a staff member immediately revokes their active session
  const deactivateStaff = await call(
    "PATCH",
    `/api/v1/admin/staff/${support.staff.id}`,
    adminToken,
    { isActive: false },
  );
  assert.equal(deactivateStaff.status, 200);
  assert.equal((await call("GET", "/api/v1/admin/services", support.token)).status, 401);

  // 4. Even Admin is bound by governance rules: audit log is read-only (405) & unknown admin routes fail closed (403)
  assert.equal((await call("DELETE", "/api/v1/admin/audit", adminToken)).status, 405);
  assert.equal((await call("GET", "/api/v1/admin/unknown-endpoint", adminToken)).status, 403);
});
