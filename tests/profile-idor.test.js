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
  process.env.ADMIN_PASSWORD = "profile-idor-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-profile-idor-"));
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

test("profile APIs prevent cross-account IDOR on read, update, delete, and privileged endpoints", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  const registerUser = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: "profile-user-pass-123" }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await registerUser("Profile User A", "profile-a@example.com");
  const userB = await registerUser("Profile User B", "profile-b@example.com");

  // User B sets their own profile info
  const setB = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      customerName: "User B Private",
      phone: "0908111222",
      address: "88 Đường Riêng Tư B, Quận 3",
    }),
  });
  assert.equal(setB.status, 200);

  // Unauthenticated access to profile endpoints -> 401
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/me`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Anon" }),
    })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, { method: "DELETE" })).status,
    401,
  );

  // /api/v1/auth/me rejects query param probing (?userId=...)
  const probeMe = await fetch(`${baseUrl}/api/v1/auth/me?userId=${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(probeMe.status, 400);

  // /api/v1/auth/customer-info rejects client-supplied userId/id targeting User B
  const spoofCustomerInfo = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      userId: userB.user.id,
      customerName: "Hacked B",
    }),
  });
  assert.equal(spoofCustomerInfo.status, 403);

  // Cross-account IDOR via /api/v1/users/{userB.id} -> 403 on GET, PATCH, PUT, DELETE
  const idorGet = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(idorGet.status, 403);
  assert.doesNotMatch(await idorGet.text(), /profile-b@example\.com|0908111222|88 Đường Riêng Tư/);

  const idorPatch = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ customerName: "Hacked B" }),
  });
  assert.equal(idorPatch.status, 403);

  const idorPut = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ customerName: "Hacked B Put" }),
  });
  assert.equal(idorPut.status, 403);

  const idorDelete = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(idorDelete.status, 403);

  // User A cannot call privileged admin user update on User B -> 403
  const adminUserPatchByUserA = await fetch(`${baseUrl}/api/v1/admin/users/${userB.user.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ studentVerificationStatus: "verified" }),
  });
  assert.equal(adminUserPatchByUserA.status, 403);

  // User A CAN read and update their OWN profile via /api/v1/users/{userA.id}
  const ownGet = await fetch(`${baseUrl}/api/v1/users/${userA.user.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(ownGet.status, 200);
  assert.equal((await ownGet.json()).user.id, userA.user.id);

  const ownPatch = await fetch(`${baseUrl}/api/v1/users/${userA.user.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ customerName: "User A Updated" }),
  });
  assert.equal(ownPatch.status, 200);
  assert.equal((await ownPatch.json()).customerInfo.customerName, "User A Updated");

  // User B's profile remains completely intact
  const verifyB = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(verifyB.status, 200);
  const { user: intactB } = await verifyB.json();
  assert.equal(intactB.customerInfo.customerName, "User B Private");
  assert.equal(intactB.customerInfo.phone, "0908111222");

  // Privileged admin (read:users) CAN read User B's safe public profile
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "profile-idor-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const adminGetB = await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminGetB.status, 200);
  const adminBText = await adminGetB.text();
  assert.doesNotMatch(adminBText, /password|salt|hash/i);
});
