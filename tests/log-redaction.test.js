"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  formatSafeErrorLog,
  redactLogObject,
  redactLogText,
} = require("../backend/monitoring");

test("redactLogText masks Bearer, Apikey, Basic, JWT, HMAC signatures, 64-hex tokens, credentials, emails, and phones while preserving requestId", () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  const rawHexToken = "ab".repeat(32);
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturePart123";
  const env = {
    ADMIN_PASSWORD: "super-secret-admin-pw",
    SEPAY_API_KEY: "sepay-live-secret-999",
    PAYMENT_WEBHOOK_SECRET: "webhook-hmac-secret-888",
  };

  const raw = [
    `requestId=${requestId}`,
    "Authorization: Bearer 11111111-2222-4333-8444-555555555555",
    "Authorization: Apikey sepay-live-secret-999",
    "Authorization: Basic dXNlcjpwYXNz",
    `X-BookNest-Signature: sha256=${rawHexToken}`,
    `X-Export-Token: ${rawHexToken}`,
    `idToken=${jwt}`,
    "password=super-secret-admin-pw",
    "currentPassword=my-old-password-123",
    "refreshToken=refresh-secret-token-xyz",
    "email=customer@example.com",
    "phone=0908123456",
    "db=postgres://booknest:db-secret-pass@db.internal:5432/prod",
  ].join(" ");

  const redacted = redactLogText(raw, env);

  // Operational requestId preserved
  assert.ok(redacted.includes(requestId), "requestId must be preserved for troubleshooting");

  // All credentials, tokens, secrets, emails, phones redacted
  for (const forbidden of [
    "11111111-2222-4333-8444-555555555555",
    "sepay-live-secret-999",
    "dXNlcjpwYXNz",
    rawHexToken,
    jwt,
    "super-secret-admin-pw",
    "my-old-password-123",
    "refresh-secret-token-xyz",
    "customer@example.com",
    "0908123456",
    "db-secret-pass",
  ]) {
    assert.equal(redacted.includes(forbidden), false, `Redacted log must NOT contain "${forbidden}"`);
  }
});

test("redactLogObject and formatSafeErrorLog sanitize nested objects and error stacks while keeping operational context", () => {
  const sanitized = redactLogObject({
    route: "/api/v1/auth/login",
    status: 401,
    headers: {
      authorization: "Bearer secret-token",
      "x-export-token": "export-secret",
      "x-order-access-code": "cd".repeat(32),
      cookie: "session=abc",
    },
    body: {
      email: "user@example.com",
      password: "Password123456!",
      phone: "0901234567",
      address: "123 Đường Riêng Tư",
    },
  });

  assert.equal(sanitized.route, "/api/v1/auth/login");
  assert.equal(sanitized.status, 401);
  assert.equal(sanitized.headers.authorization, "[REDACTED]");
  assert.equal(sanitized.headers["x-export-token"], "[REDACTED]");
  assert.equal(sanitized.headers["x-order-access-code"], "[REDACTED]");
  assert.equal(sanitized.headers.cookie, "[REDACTED]");
  assert.equal(sanitized.body.email, "[REDACTED]");
  assert.equal(sanitized.body.password, "[REDACTED]");
  assert.equal(sanitized.body.phone, "[REDACTED]");
  assert.equal(sanitized.body.address, "[REDACTED]");

  const errLog = formatSafeErrorLog({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    method: "POST",
    route: "/api/payments/sepay-webhook",
    message: "Failed with Apikey top-secret-key",
    error: new Error("Auth failed for user@example.com Bearer my-secret-token"),
  });
  assert.equal(errLog.level, "error");
  assert.equal(errLog.event, "request_error");
  assert.equal(errLog.requestId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(errLog.route, "/api/payments/sepay-webhook");
  assert.doesNotMatch(JSON.stringify(errLog), /top-secret-key|user@example\.com|my-secret-token/);
});

test("HTTP request and error logs across auth, payment webhook, and customer flows never leak raw credentials or tokens", async (t) => {
  const captured = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => captured.push(args.join(" "));
  console.warn = (...args) => captured.push(args.join(" "));
  console.error = (...args) => captured.push(args.join(" "));
  t.after(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-log-redact-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    paymentWebhookSecret: "webhook-secret-must-never-appear-1234",
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

  const secretPassword = "unique-log-test-password-999";
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Log Privacy User",
      email: "log-privacy-user@example.com",
      password: secretPassword,
    }),
  });
  assert.equal(regRes.status, 201);
  const { token } = await regRes.json();

  // Trigger auth, order, and payment webhook logs
  await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await fetch(`${baseUrl}/api/v1/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BookNest-Signature": `sha256=${"ef".repeat(32)}`,
    },
    body: JSON.stringify({ id: "evt-log-test" }),
  });

  const allLogs = captured.join("\n");
  assert.ok(allLogs.includes("http_request"), "Structured http_request logs must be emitted");
  for (const sensitive of [
    secretPassword,
    token,
    "log-privacy-user@example.com",
    "webhook-secret-must-never-appear-1234",
    "ef".repeat(32),
  ]) {
    assert.equal(allLogs.includes(sensitive), false, `Runtime logs must NEVER contain "${sensitive}"`);
  }
});
