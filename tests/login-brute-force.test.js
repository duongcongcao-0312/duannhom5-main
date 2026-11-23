"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-bf-"));
  const auditLogPath = path.join(directory, "audit.jsonl");
  const alerts = [];
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
    loginAttemptLimit: 3,
    loginAttemptWindowMs: 1200,
    loginAccountAttemptLimit: 4,
    loginAccountWindowMs: 1200,
    monitoringAlertUrl: "https://alerts.booknest.example/hook",
    monitoringAlertCooldownMs: 0,
    monitoringAlertFetch: async (_url, options) => {
      alerts.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
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
    auditLogPath,
    alerts,
  };
}

test("login brute-force protection blocks repeated failures per source without leaking account existence and logs safely", async (t) => {
  const { baseUrl, auditLogPath, alerts } = await withServer(t);
  const secretPassword = "SuperSecretPassword!2026";
  const wrongPassword = "WrongGuessPassword!9999";
  const existingEmail = "victim@example.com";
  const missingEmail = "nonexistent-user@example.com";

  // Register an account
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Victim User", email: existingEmail, password: secretPassword }),
  });
  assert.equal(reg.status, 201);

  // Attempt 1: existing email, wrong password -> generic 401
  const failExisting = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: existingEmail, password: wrongPassword }),
  });
  assert.equal(failExisting.status, 401);
  const existingBody = await failExisting.json();

  // Attempt 2: non-existing email -> identical generic 401 error message & code
  const failMissing = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: missingEmail, password: wrongPassword }),
  });
  assert.equal(failMissing.status, 401);
  const missingBody = await failMissing.json();
  assert.equal(existingBody.error, missingBody.error);
  assert.equal(existingBody.code, missingBody.code);

  // Attempt 3: still within per-IP limit (3)
  const failThird = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: existingEmail, password: wrongPassword }),
  });
  assert.equal(failThird.status, 401);

  // Attempt 4: exceeds per-IP limit -> 429 with Retry-After
  const blocked = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: existingEmail, password: secretPassword }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

  // Wait for window expiry and verify legitimate login succeeds
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const recovered = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: existingEmail, password: secretPassword }),
  });
  assert.equal(recovered.status, 200);
  const { token } = await recovered.json();
  assert.ok(token);

  // Verify audit log recorded failed, blocked, and succeeded events without leaking secrets or emails
  const rawAudit = await fs.readFile(auditLogPath, "utf8");
  const entries = rawAudit
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes("auth.login.failed"));
  assert.ok(actions.includes("auth.login.blocked"));
  assert.ok(actions.includes("auth.login.succeeded"));
  assert.ok(!rawAudit.includes(secretPassword), "audit log must never contain password");
  assert.ok(!rawAudit.includes(wrongPassword), "audit log must never contain wrong password");
  assert.ok(!rawAudit.includes(token), "audit log must never contain session token");
  assert.ok(!rawAudit.includes(existingEmail), "audit log must never contain raw email");

  // Verify monitoring alert was dispatched for brute-force block
  assert.ok(alerts.some((a) => a.event === "auth_login_brute_force_blocked"));
});

test("distributed brute-force against a single account across multiple IPs is blocked uniformly", async (t) => {
  const { baseUrl } = await withServer(t, {
    trustedProxyHops: 1,
    trustedProxyIps: "127.0.0.1",
    loginAttemptLimit: 5,
    loginAccountAttemptLimit: 3,
    loginAccountWindowMs: 1200,
  });

  // 3 failed logins for the same target email from 3 distinct IPs (below per-IP limit of 5)
  for (let i = 1; i <= 3; i += 1) {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${i}`,
      },
      body: JSON.stringify({ email: "distributed-target@example.com", password: "wrong-password-123" }),
    });
    assert.equal(res.status, 401);
  }

  // 4th attempt from a 4th distinct IP hits the per-account threshold -> 429
  const blocked = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.4",
    },
    body: JSON.stringify({ email: "distributed-target@example.com", password: "wrong-password-123" }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
});
