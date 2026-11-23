"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-logout-all-"));
  const auditLogPath = path.join(directory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    auditLogPath,
  };
}

test("logout-all revokes every active session and refresh capability across devices without affecting other users", async (t) => {
  const { baseUrl, auditLogPath } = await withServer(t);

  // Unauthenticated logout-all is rejected with 401
  const unauthRes = await fetch(`${baseUrl}/api/v1/auth/logout-all`, { method: "POST" });
  assert.equal(unauthRes.status, 401);

  // Register User 1 (Device A) and User 2 (Other User)
  const u1Reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Multi Device User", email: "multi@example.com", password: "multi-device-password-123" }),
  });
  assert.equal(u1Reg.status, 201);
  const { token: deviceAToken } = await u1Reg.json();

  const u2Reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Other User", email: "other-user@example.com", password: "other-user-password-123" }),
  });
  assert.equal(u2Reg.status, 201);
  const { token: otherUserToken } = await u2Reg.json();

  // User 1 logs in on Device B and Device C
  const loginB = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "multi@example.com", password: "multi-device-password-123" }),
  });
  assert.equal(loginB.status, 200);
  const { token: deviceBToken } = await loginB.json();

  const loginC = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "multi@example.com", password: "multi-device-password-123" }),
  });
  assert.equal(loginC.status, 200);
  const { token: deviceCToken } = await loginC.json();

  // Verify all 3 sessions work before revocation
  for (const tok of [deviceAToken, deviceBToken, deviceCToken]) {
    const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    assert.equal(me.status, 200);
  }

  // Device A triggers logout-all
  const logoutAllRes = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceAToken}` },
  });
  assert.equal(logoutAllRes.status, 200);
  const logoutAllBody = await logoutAllRes.json();
  assert.equal(logoutAllBody.revoked, true);

  // All 3 old access tokens AND refresh attempts are immediately rejected (401)
  for (const tok of [deviceAToken, deviceBToken, deviceCToken]) {
    const meAfter = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    assert.equal(meAfter.status, 401);

    const cookieAfter = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `bn_session=${tok}` },
    });
    assert.equal(cookieAfter.status, 401);

    const refreshAfter = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    assert.equal(refreshAfter.status, 401);
  }

  // Other user's session remains completely valid
  const otherMe = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${otherUserToken}` },
  });
  assert.equal(otherMe.status, 200);

  // Audit log records auth.sessions.revoke_all
  const auditRaw = await fs.readFile(auditLogPath, "utf8");
  assert.match(auditRaw, /"action":"auth\.sessions\.revoke_all"/);
});

test("storefront and admin UI expose logout-all-devices actions wired to /api/auth/logout-all", async () => {
  const root = path.join(__dirname, "..");
  const [indexHtml, mainJs, adminHtml, adminJs] = await Promise.all([
    fs.readFile(path.join(root, "index.html"), "utf8"),
    fs.readFile(path.join(root, "main.js"), "utf8"),
    fs.readFile(path.join(root, "admin.html"), "utf8"),
    fs.readFile(path.join(root, "admin.js"), "utf8"),
  ]);
  assert.match(indexHtml, /id="logoutAllButton"/);
  assert.match(mainJs, /\/api\/auth\/logout-all/);
  assert.match(adminHtml, /id="adminLogoutAllBtn"/);
  assert.match(adminJs, /\/api\/auth\/logout-all/);
});
