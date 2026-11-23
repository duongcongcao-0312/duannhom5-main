"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-chgpwd-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
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
    usersPath,
    auditLogPath,
  };
}

test("change-password requires auth & valid current password, hashes new password safely, and revokes all other sessions", async (t) => {
  const { baseUrl, usersPath, auditLogPath } = await withServer(t);
  const email = "chg-pwd@example.com";
  const oldPassword = "Old-Secure-Password!2026";
  const newPassword = "New-Secure-Password!2026";

  // 1. Unauthenticated request rejected (401)
  const unauth = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
  });
  assert.equal(unauth.status, 401);

  // Register on Device A and log in on Device B
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Change Pwd User", email, password: oldPassword }),
  });
  assert.equal(reg.status, 201);
  const { token: deviceAToken, refreshToken: deviceARefresh } = await reg.json();

  const loginB = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: oldPassword }),
  });
  assert.equal(loginB.status, 200);
  const { token: deviceBToken, refreshToken: deviceBRefresh } = await loginB.json();

  // 2. Wrong currentPassword rejected (401) and leaves sessions intact
  const wrongCurrent = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceAToken}`,
    },
    body: JSON.stringify({ currentPassword: "Wrong-Current-Password!99", newPassword }),
  });
  assert.equal(wrongCurrent.status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${deviceBToken}` } })).status,
    200,
  );

  // 3. Valid change-password succeeds, rotates caller session, and revokes Device A old token & Device B session
  const changeRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceAToken}`,
    },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
  });
  assert.equal(changeRes.status, 200);
  const changeBody = await changeRes.json();
  assert.ok(changeBody.token && changeBody.token !== deviceAToken);
  assert.ok(changeBody.refreshToken && changeBody.refreshToken !== deviceARefresh);

  // New rotated session works immediately
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${changeBody.token}` } })).status,
    200,
  );

  // Old Device A & Device B access tokens AND refresh attempts are all revoked (401)
  for (const [tok, ref] of [
    [deviceAToken, deviceARefresh],
    [deviceBToken, deviceBRefresh],
  ]) {
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).status,
      401,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ refreshToken: ref }),
      })).status,
      401,
    );
  }

  // Stored password hash is updated to versioned scrypt format (never plaintext)
  const users = JSON.parse(await fs.readFile(usersPath, "utf8"));
  const storedUser = users.find((u) => u.email === email);
  assert.match(storedUser.password, /^scrypt\$N=16384,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.ok(!storedUser.password.includes(newPassword));

  // Old password can no longer log in; new password logs in cleanly
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: oldPassword }),
    })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: newPassword }),
    })).status,
    200,
  );

  // Audit log recorded auth.password.changed without leaking secrets
  const rawAudit = await fs.readFile(auditLogPath, "utf8");
  assert.match(rawAudit, /"action":"auth\.password\.changed"/);
  assert.ok(!rawAudit.includes(oldPassword));
  assert.ok(!rawAudit.includes(newPassword));
});

test("storefront UI exposes change-password form wired to /api/auth/change-password", async () => {
  const root = path.join(__dirname, "..");
  const [indexHtml, mainJs] = await Promise.all([
    fs.readFile(path.join(root, "index.html"), "utf8"),
    fs.readFile(path.join(root, "main.js"), "utf8"),
  ]);
  assert.match(indexHtml, /id="changePasswordForm"/);
  assert.match(indexHtml, /id="changePasswordNavButton"/);
  assert.match(mainJs, /\/api\/auth\/change-password/);
});
