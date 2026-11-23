"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const { hashPasswordResetToken } = require("../backend/auth");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "revoke-admin-secret-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("compromised account session revocation invalidates all sessions, export tokens, enforces forced password reset, and logs security audit events", async (t) => {
  configureAdminEnv(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-session-revoke-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Register user (session 1) and login on a second device (session 2)
  const initialPassword = "compromised-user-pass-123";
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Victim User",
      email: "victim@example.com",
      password: initialPassword,
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: device1Token, user } = await regRes.json();

  const login2Res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "victim@example.com", password: initialPassword }),
  });
  assert.equal(login2Res.status, 200);
  const { token: device2Token } = await login2Res.json();

  // Create an active personal data export on device 1
  const exportRes = await fetch(`${baseUrl}/api/v1/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${device1Token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: initialPassword }),
  });
  assert.equal(exportRes.status, 201);
  const { export: activeExport } = await exportRes.json();

  // 2. Self-service POST /api/v1/auth/logout-all revokes BOTH device sessions and purges active exports
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/logout-all`, { method: "POST" })).status, 401);
  const logoutAllRes = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${device1Token}` },
  });
  assert.equal(logoutAllRes.status, 200);
  const logoutAllBody = await logoutAllRes.json();
  assert.equal(logoutAllBody.revoked, true);
  assert.equal(logoutAllBody.exportsPurged, 1);

  // Both old tokens are immediately rejected with 401
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${device1Token}` } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${device2Token}` } })).status,
    401,
  );

  // 3. Re-login on device 3; verify non-admin cannot call admin revoke-sessions
  const login3Res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "victim@example.com", password: initialPassword }),
  });
  assert.equal(login3Res.status, 200);
  const { token: device3Token } = await login3Res.json();

  // Old export was purged (404)
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/privacy/exports/${activeExport.id}/download`, {
      headers: {
        Authorization: `Bearer ${device3Token}`,
        "X-Export-Token": activeExport.downloadToken,
      },
    })).status,
    404,
  );

  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/users/${user.id}/revoke-sessions`, { method: "POST" })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/admin/users/${user.id}/revoke-sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${device3Token}` },
    })).status,
    403,
  );

  // 4. Admin triggers emergency revocation with forcePasswordReset: true
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "revoke-admin-secret-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const adminRevoke = await fetch(`${baseUrl}/api/v1/admin/users/${user.id}/revoke-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      forcePasswordReset: true,
      reason: "suspected_credential_leak",
    }),
  });
  assert.equal(adminRevoke.status, 200);
  const revokeBody = await adminRevoke.json();
  assert.equal(revokeBody.revoked, true);
  assert.equal(revokeBody.forcePasswordReset, true);

  // Active token immediately fails (401) and old password login is blocked (403 PASSWORD_RESET_REQUIRED)
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${device3Token}` } })).status,
    401,
  );
  const blockedLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "victim@example.com", password: initialPassword }),
  });
  assert.equal(blockedLogin.status, 403);
  assert.equal((await blockedLogin.json()).code, "PASSWORD_RESET_REQUIRED");

  // 5. Completing password reset clears mustResetPassword and restores access with the new password
  const db = new Database({ usersPath });
  const resetToken = crypto.randomBytes(32).toString("hex");
  await db.createPasswordResetToken(
    "victim@example.com",
    hashPasswordResetToken(resetToken),
    new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  );

  const newPassword = "recovered-strong-pass-456";
  const confirmReset = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: newPassword }),
  });
  assert.equal(confirmReset.status, 200);

  const recoveredLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "victim@example.com", password: newPassword }),
  });
  assert.equal(recoveredLogin.status, 200);

  // 6. Security audit log recorded both revocation events with ZERO leaked tokens/passwords
  const auditRaw = await fs.readFile(auditLogPath, "utf8");
  assert.match(auditRaw, /auth\.sessions\.revoke_all/);
  assert.match(auditRaw, /security\.account\.sessions_revoked/);
  assert.doesNotMatch(auditRaw, new RegExp(`${device1Token}|${device2Token}|${device3Token}|${initialPassword}`));

  // 7. Runbook documentation exists
  const runbook = fsSync.readFileSync(
    path.join(__dirname, "..", "docs", "compromised-account-runbook.md"),
    "utf8",
  );
  assert.match(runbook, /logout-all/);
  assert.match(runbook, /revoke-sessions/);
  assert.match(runbook, /PASSWORD_RESET_REQUIRED/);
});
