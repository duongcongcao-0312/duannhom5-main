"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-pwreset-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "audit.jsonl");
  const sentEmails = [];
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
    appBaseUrl: "https://booknest.example",
    passwordResetMailer: {
      sendPasswordReset: async (entry) => {
        sentEmails.push(entry);
      },
    },
    ...overrides,
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
    sentEmails,
  };
}

function extractResetToken(url) {
  const hash = new URL(url).hash.replace(/^#/, "");
  return new URLSearchParams(hash).get("resetToken");
}

test("password reset returns identical responses for existing vs missing email, hashes token, revokes sessions, and enforces single-use", async (t) => {
  const { baseUrl, usersPath, auditLogPath, sentEmails } = await withServer(t);
  const email = "reset-user@example.com";
  const oldPassword = "Old-Reset-Password!2026";
  const newPassword = "New-Reset-Password!2026";

  // Register user and capture active session
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reset User", email, password: oldPassword }),
  });
  assert.equal(reg.status, 201);
  const { token: activeSessionToken, refreshToken: activeRefreshToken } = await reg.json();

  // Request reset for existing vs non-existing email -> identical 200 response, no token leaked
  const reqExisting = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const reqMissing = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nobody-here@example.com" }),
  });
  assert.equal(reqExisting.status, 200);
  assert.equal(reqMissing.status, 200);
  const existingBody = await reqExisting.json();
  const missingBody = await reqMissing.json();
  assert.deepEqual(existingBody, missingBody);

  // Only existing user received an email; token is stored ONLY as a hash in users.json
  assert.equal(sentEmails.length, 1);
  const resetToken = extractResetToken(sentEmails[0].url);
  assert.match(resetToken, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(existingBody).includes(resetToken));

  const usersRaw = await fs.readFile(usersPath, "utf8");
  assert.ok(!usersRaw.includes(resetToken), "plaintext reset token must never be stored on disk");

  // Invalid / wrong token rejected with 400
  const wrongTokenRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "a".repeat(64), password: newPassword }),
  });
  assert.equal(wrongTokenRes.status, 400);

  // Valid confirmation succeeds, clears cookies, and revokes all active sessions
  const confirmRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: newPassword }),
  });
  assert.equal(confirmRes.status, 200);

  // Active session and refresh token from before reset are immediately revoked (401)
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${activeSessionToken}` } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeSessionToken}` },
      body: JSON.stringify({ refreshToken: activeRefreshToken }),
    })).status,
    401,
  );

  // Reusing the same reset token is rejected (single-use)
  const reuseRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: "Another-Password!2026" }),
  });
  assert.equal(reuseRes.status, 400);

  // Old password fails, new password logs in
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

  // Audit log recorded events without leaking resetToken, password, or email
  const auditRaw = await fs.readFile(auditLogPath, "utf8");
  assert.match(auditRaw, /"action":"auth\.password_reset\.requested"/);
  assert.match(auditRaw, /"action":"auth\.password_reset\.completed"/);
  assert.ok(!auditRaw.includes(resetToken));
  assert.ok(!auditRaw.includes(newPassword));
  assert.ok(!auditRaw.includes(email));
});

test("password reset rejects expired tokens, invalidates superseded tokens on resend, and rate-limits repeated sends", async (t) => {
  const { baseUrl, sentEmails } = await withServer(t, {
    passwordResetTtlMs: 120,
    passwordResetEmailLimit: 2,
    passwordResetIpLimit: 10,
    passwordResetWindowMs: 5000,
  });
  const email = "resend-expire@example.com";

  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Resend User", email, password: "Resend-Password!2026" }),
  });
  assert.equal(reg.status, 201);

  // Send #1 and Send #2 (superseded token1 by token2)
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })).status,
    200,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })).status,
    200,
  );
  assert.equal(sentEmails.length, 2);
  const token1 = extractResetToken(sentEmails[0].url);
  const token2 = extractResetToken(sentEmails[1].url);
  assert.notEqual(token1, token2);

  // Send #3 exceeds per-email rate limit -> 429 with Retry-After
  const rateLimited = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(rateLimited.status, 429);
  assert.ok(Number(rateLimited.headers.get("retry-after")) >= 1);

  // Superseded token1 is immediately invalid
  const supersededRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token1, password: "Superseded-Password!2026" }),
  });
  assert.equal(supersededRes.status, 400);

  // Wait for token2 to expire -> rejected with 400
  await new Promise((resolve) => setTimeout(resolve, 160));
  const expiredRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token2, password: "Expired-Password!2026" }),
  });
  assert.equal(expiredRes.status, 400);
});
