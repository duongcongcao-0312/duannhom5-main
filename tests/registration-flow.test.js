"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-reg-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
    registrationAttemptLimit: 20,
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
  };
}

test("registration validates inputs, blocks mass-assignment, initializes safe unverified user state, and never leaks secrets", async (t) => {
  const { baseUrl, usersPath, auditLogPath } = await withServer(t);

  // 1. Malformed email rejected (400)
  const badEmail = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bad Email", email: "not-an-email", password: "Valid-Strong-Password!2026" }),
  });
  assert.equal(badEmail.status, 400);

  // 2. Mass-assignment attempts (role: admin, emailVerified: true) rejected (400)
  const massAssignRole = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Escalation",
      email: "escalate@example.com",
      password: "Valid-Strong-Password!2026",
      role: "admin",
    }),
  });
  assert.equal(massAssignRole.status, 400);

  const massAssignVerified = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Escalation",
      email: "escalate2@example.com",
      password: "Valid-Strong-Password!2026",
      emailVerified: true,
    }),
  });
  assert.equal(massAssignVerified.status, 400);

  // 3. Valid registration creates safe account state (role=user, emailVerified=false, scrypt hash)
  const secretPassword = "Valid-Reg-Password!2026";
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Customer",
      email: "  New.Customer@Example.COM  ",
      password: secretPassword,
    }),
  });
  assert.equal(regRes.status, 201);
  const regText = await regRes.text();
  assert.ok(!regText.includes(secretPassword));
  assert.ok(!regText.includes("scrypt$"));

  const regBody = JSON.parse(regText);
  assert.equal(regBody.user.email, "new.customer@example.com");
  assert.equal(regBody.user.role, "user");
  assert.equal(regBody.user.emailVerified, false);

  const users = JSON.parse(await fs.readFile(usersPath, "utf8"));
  const saved = users.find((u) => u.email === "new.customer@example.com");
  assert.ok(saved);
  assert.equal(saved.emailVerified, false);
  assert.equal(saved.isActive, true);
  assert.equal(saved.role, "user");
  assert.match(saved.password, /^scrypt\$N=16384,r=8,p=1\$/);

  // Audit log recorded registration without leaking password, token, or email
  const auditRaw = await fs.readFile(auditLogPath, "utf8");
  assert.match(auditRaw, /"action":"auth\.register\.succeeded"/);
  assert.ok(!auditRaw.includes(secretPassword));
  assert.ok(!auditRaw.includes(regBody.token));
  assert.ok(!auditRaw.includes("new.customer@example.com"));
});

test("registration rejects duplicate emails (including case/whitespace variants), serializes concurrent duplicates, and enforces rate limit", async (t) => {
  const { baseUrl, usersPath } = await withServer(t, {
    registrationAttemptLimit: 3,
    registrationAttemptWindowMs: 5000,
  });

  // Concurrent duplicate registration for the same email -> exactly 1 succeeds (201), 1 fails (409)
  const [r1, r2] = await Promise.all([
    fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race User 1", email: "race@example.com", password: "Race-Strong-Password!2026" }),
    }),
    fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race User 2", email: "RACE@example.com", password: "Race-Strong-Password!2026" }),
    }),
  ]);
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409]);

  // Verify only one account was persisted
  const users = JSON.parse(await fs.readFile(usersPath, "utf8"));
  assert.equal(users.filter((u) => u.email === "race@example.com").length, 1);

  // Subsequent duplicate attempt returns generic 409
  const dup = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Dup", email: "  race@example.com ", password: "Race-Strong-Password!2026" }),
  });
  assert.equal(dup.status, 409);

  // 4th attempt is allowed, 5th exceeds registrationAttemptLimit=4 -> 429 with Retry-After
  await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User 4", email: "user4@example.com", password: "Valid-Strong-Password!2026" }),
  });
  const limited = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User 5", email: "user5@example.com", password: "Valid-Strong-Password!2026" }),
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});
