"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-auth-rl-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    loginAttemptLimit: 2,
    loginAttemptWindowMs: 1000,
    registrationAttemptLimit: 2,
    registrationAttemptWindowMs: 1000,
    passwordResetIpLimit: 2,
    passwordResetEmailLimit: 2,
    passwordResetWindowMs: 1000,
    appBaseUrl: "https://booknest.example",
    passwordResetMailer: { sendPasswordReset: async () => {} },
    socialTokenVerifier: async () => {
      throw new Error("invalid social token");
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
  return `http://127.0.0.1:${server.address().port}`;
}

test("auth endpoints enforce rate limits with safe 429 + Retry-After, ignore untrusted X-Forwarded-For, and recover after window reset", async (t) => {
  const baseUrl = await withServer(t);

  // 1. Register rate limit (limit=2) + untrusted X-Forwarded-For cannot bypass
  const reg1 = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.1" },
    body: JSON.stringify({ name: "RL User 1", email: "rl1@example.com", password: "rl-user-password-123" }),
  });
  assert.equal(reg1.status, 201);
  const { token } = await reg1.json();

  const reg2 = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.2" },
    body: JSON.stringify({ name: "RL User 2", email: "rl2@example.com", password: "rl-user-password-123" }),
  });
  assert.equal(reg2.status, 201);

  const reg3 = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.3" },
    body: JSON.stringify({ name: "RL User 3", email: "rl3@example.com", password: "rl-user-password-123" }),
  });
  assert.equal(reg3.status, 429);
  assert.ok(Number(reg3.headers.get("retry-after")) >= 1);

  // 2. Login rate limit (limit=2) -> 3rd attempt returns 429 even with spoofed X-Forwarded-For
  for (let i = 0; i < 2; i += 1) {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${i + 1}` },
      body: JSON.stringify({ email: "rl1@example.com", password: "wrong-password-123" }),
    });
    assert.equal(res.status, 401);
  }
  const loginBlocked = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.99" },
    body: JSON.stringify({ email: "rl1@example.com", password: "wrong-password-123" }),
  });
  assert.equal(loginBlocked.status, 429);
  assert.ok(Number(loginBlocked.headers.get("retry-after")) >= 1);

  // 3. Password reset request & confirm rate limits
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "rl1@example.com" }),
      })).status,
      200,
    );
  }
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "rl1@example.com" }),
    })).status,
    429,
  );

  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "a".repeat(64), password: "new-valid-password-123" }),
      })).status,
      400,
    );
  }
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(64), password: "new-valid-password-123" }),
    })).status,
    429,
  );

  // 4. Social auth rate limit
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await fetch(`${baseUrl}/api/v1/auth/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer bad-firebase-token" },
        body: JSON.stringify({ email: "rl1@example.com" }),
      })).status,
      401,
    );
  }
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer bad-firebase-token" },
      body: JSON.stringify({ email: "rl1@example.com" }),
    })).status,
    429,
  );

  // 5. Refresh token endpoint rate limit (2 valid refreshes succeed, 3rd returns 429)
  for (let i = 0; i < 2; i += 1) {
    const refreshOk = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(refreshOk.status, 200);
  }
  const refreshBlocked = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(refreshBlocked.status, 429);

  // 6. After rate-limit window expires (1000ms), legitimate login & refresh succeed again
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const loginRecovered = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "rl1@example.com", password: "rl-user-password-123" }),
  });
  assert.equal(loginRecovered.status, 200);

  const refreshRecovered = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(refreshRecovered.status, 200);
});
