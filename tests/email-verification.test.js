"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-email-verify-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "audit.jsonl");
  const sentVerifications = [];
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
    appBaseUrl: "https://booknest.example",
    passwordResetMailer: {
      sendPasswordReset: async () => {},
      sendEmailVerification: async (entry) => {
        sentVerifications.push(entry);
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
    sentVerifications,
  };
}

function extractVerifyToken(url) {
  const hash = new URL(url).hash.replace(/^#/, "");
  return new URLSearchParams(hash).get("verifyEmailToken");
}

test("email verification issues hashed single-use token, verifies email, rejects wrong/reused tokens, and avoids enumeration", async (t) => {
  const { baseUrl, usersPath, auditLogPath, sentVerifications } = await withServer(t);
  const email = "verify-me@example.com";

  // Register account (starts unverified)
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Verify User", email, password: "Verify-Strong-Password!2026" }),
  });
  assert.equal(reg.status, 201);
  const { token: sessionToken, user } = await reg.json();
  assert.equal(user.emailVerified, false);

  // Request verification for existing vs missing email -> identical 200 response
  const reqExisting = await fetch(`${baseUrl}/api/v1/auth/verify-email/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  const reqMissing = await fetch(`${baseUrl}/api/v1/auth/verify-email/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "unknown-email@example.com" }),
  });
  assert.equal(reqExisting.status, 200);
  assert.equal(reqMissing.status, 200);
  assert.deepEqual(await reqExisting.json(), await reqMissing.json());

  // Only existing unverified user got an email; token stored ONLY as hash on disk
  assert.equal(sentVerifications.length, 1);
  const verifyToken = extractVerifyToken(sentVerifications[0].url);
  assert.match(verifyToken, /^[a-f0-9]{64}$/);
  const rawUsers = await fs.readFile(usersPath, "utf8");
  assert.ok(!rawUsers.includes(verifyToken), "plaintext verification token must never be stored");

  // Wrong / malformed tokens rejected with 400
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not-hex" }),
    })).status,
    400,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "b".repeat(64) }),
    })).status,
    400,
  );

  // Valid token verifies email
  const confirmOk = await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  });
  assert.equal(confirmOk.status, 200);
  const confirmBody = await confirmOk.json();
  assert.equal(confirmBody.verified, true);
  assert.equal(confirmBody.user.emailVerified, true);

  // /api/v1/auth/me reflects verified state
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal((await meRes.json()).user.emailVerified, true);

  // Reusing the same token is rejected (single-use)
  const reuseRes = await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  });
  assert.equal(reuseRes.status, 400);

  // Requesting again after already verified does not send another email
  const reqAfterVerified = await fetch(`${baseUrl}/api/v1/auth/verify-email/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(reqAfterVerified.status, 200);
  assert.equal(sentVerifications.length, 1);

  // Audit log recorded events without leaking raw token or email
  const rawAudit = await fs.readFile(auditLogPath, "utf8");
  assert.match(rawAudit, /"action":"auth\.email_verification\.requested"/);
  assert.match(rawAudit, /"action":"auth\.email_verification\.completed"/);
  assert.ok(!rawAudit.includes(verifyToken));
  assert.ok(!rawAudit.includes(email));
});

test("email verification rejects expired tokens, invalidates superseded tokens on resend, and rate-limits resends", async (t) => {
  const { baseUrl, sentVerifications } = await withServer(t, {
    emailVerificationTtlMs: 120,
    passwordResetEmailLimit: 2,
    passwordResetIpLimit: 10,
    passwordResetWindowMs: 5000,
  });
  const email = "resend-verify@example.com";

  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Resend Verify", email, password: "Resend-Verify-Pass!2026" }),
  });
  assert.equal(reg.status, 201);

  // Resend #1 & #2 succeed; #3 is rate-limited (429 + Retry-After)
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/verify-email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })).status,
      200,
    );
  }
  const blocked = await fetch(`${baseUrl}/api/v1/auth/verify-email/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

  assert.equal(sentVerifications.length, 2);
  const token1 = extractVerifyToken(sentVerifications[0].url);
  const token2 = extractVerifyToken(sentVerifications[1].url);
  assert.notEqual(token1, token2);

  // Superseded token1 is rejected
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token1 }),
    })).status,
    400,
  );

  // Wait past emailVerificationTtlMs -> token2 is rejected as expired
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/verify-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token2 }),
    })).status,
    400,
  );
});
