"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  DEFAULT_ERROR_CODES,
  GENERIC_CLIENT_ERROR_MESSAGE,
  GENERIC_SERVER_ERROR_MESSAGE,
  buildApiErrorPayload,
  containsSensitiveOrInternalDetail,
  resolveCorrelationId,
} = require("../backend/api-errors");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "api-errors-admin-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-api-errors-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    ...options,
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

test("api-errors module maps status codes, redacts SQL/stack/tokens/PII, and protects correlation IDs", () => {
  assert.equal(DEFAULT_ERROR_CODES[400], "BAD_REQUEST");
  assert.equal(DEFAULT_ERROR_CODES[401], "UNAUTHORIZED");
  assert.equal(DEFAULT_ERROR_CODES[403], "FORBIDDEN");
  assert.equal(DEFAULT_ERROR_CODES[404], "NOT_FOUND");
  assert.equal(DEFAULT_ERROR_CODES[409], "CONFLICT");
  assert.equal(DEFAULT_ERROR_CODES[500], "INTERNAL_ERROR");

  // Detects SQL, stack traces, paths, tokens, emails, and phones
  for (const sensitive of [
    'SELECT * FROM users WHERE id = 1',
    'duplicate key value violates unique constraint "users_email_key"',
    'Error: connect ECONNREFUSED 127.0.0.1:5432',
    'at Object.<anonymous> (C:\\Users\\admin\\server.js:12:4)',
    'postgres://user:pass@db.internal:5432/booknest',
    'Bearer super-secret-session-token-1234',
    'Email leaked@example.com already exists',
    'Phone 0901234567 invalid',
  ]) {
    assert.equal(containsSensitiveOrInternalDetail(sensitive), true, `Should detect: ${sensitive}`);
  }

  // Server errors always return generic message
  const serverErr = buildApiErrorPayload({
    error: new Error('SELECT * FROM users; relation "users" failed at /var/app/db.js:10:2'),
    status: 500,
    isExpectedError: false,
    requestId: "req-500-test",
  });
  assert.equal(serverErr.status, 500);
  assert.deepEqual(serverErr.payload, {
    error: GENERIC_SERVER_ERROR_MESSAGE,
    code: "INTERNAL_ERROR",
    requestId: "req-500-test",
  });

  // Even an expected 400 with accidental SQL/PII gets replaced with safe client message
  const leakedClientErr = buildApiErrorPayload({
    error: { status: 400, message: "Invalid email victim@example.com in SELECT * FROM users" },
    status: 400,
    isExpectedError: true,
    requestId: "req-400-safe",
  });
  assert.equal(leakedClientErr.payload.error, GENERIC_CLIENT_ERROR_MESSAGE);
  assert.equal(leakedClientErr.payload.code, "BAD_REQUEST");

  // Correlation ID safety
  assert.equal(
    resolveCorrelationId({ headers: { "x-request-id": "trace-2026.01:abc" } }),
    "trace-2026.01:abc",
  );
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig";
  assert.notEqual(
    resolveCorrelationId({ headers: { "x-request-id": jwt } }),
    jwt,
  );
  assert.notEqual(
    resolveCorrelationId({
      headers: {
        authorization: "Bearer my-secret-token",
        "x-request-id": "my-secret-token",
      },
    }),
    "my-secret-token",
  );
  assert.notEqual(
    resolveCorrelationId({
      headers: {
        "x-order-access-code": "a".repeat(64),
        "x-request-id": "a".repeat(64),
      },
    }),
    "a".repeat(64),
  );
});

test("HTTP API returns consistent error schema for validation, auth, not found, conflict, and internal server errors", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Validation error (400 VALIDATION_ERROR) with preserved safe X-Request-Id
  const validationRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "corr-validation-001",
    },
    body: JSON.stringify({ email: "user@example.com", password: "123", unexpected: true }),
  });
  assert.equal(validationRes.status, 400);
  assert.equal(validationRes.headers.get("x-request-id"), "corr-validation-001");
  const validationBody = await validationRes.json();
  assert.equal(validationBody.code, "VALIDATION_ERROR");
  assert.equal(validationBody.requestId, "corr-validation-001");
  assert.ok(typeof validationBody.error === "string");
  assert.ok(Array.isArray(validationBody.details));

  // 2. Auth errors (401 UNAUTHORIZED & 403 FORBIDDEN) + credential-like X-Request-Id is replaced
  const fakeBearer = "secret-bearer-token-value-123";
  const unauthRes = await fetch(`${baseUrl}/api/v1/admin/stats`, {
    headers: {
      Authorization: `Bearer ${fakeBearer}`,
      "X-Request-Id": fakeBearer,
    },
  });
  assert.equal(unauthRes.status, 401);
  const unauthReqId = unauthRes.headers.get("x-request-id");
  assert.ok(unauthReqId && unauthReqId !== fakeBearer);
  const unauthBody = await unauthRes.json();
  assert.equal(unauthBody.code, "UNAUTHORIZED");
  assert.equal(unauthBody.requestId, unauthReqId);
  assert.doesNotMatch(JSON.stringify(unauthBody), new RegExp(fakeBearer));

  // Register normal user -> test 403 FORBIDDEN & 409 CONFLICT
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Error Test Reader",
      email: "err-reader@example.com",
      password: "err-reader-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: userToken } = await regRes.json();

  const forbiddenRes = await fetch(`${baseUrl}/api/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.equal(forbiddenRes.status, 403);
  const forbiddenBody = await forbiddenRes.json();
  assert.equal(forbiddenBody.code, "FORBIDDEN");
  assert.equal(forbiddenBody.requestId, forbiddenRes.headers.get("x-request-id"));

  // 3. Conflict error (409 CONFLICT) on duplicate registration
  const conflictRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Duplicate Reader",
      email: "err-reader@example.com",
      password: "err-reader-password-123",
    }),
  });
  assert.equal(conflictRes.status, 409);
  const conflictBody = await conflictRes.json();
  assert.equal(conflictBody.code, "CONFLICT");
  assert.equal(conflictBody.requestId, conflictRes.headers.get("x-request-id"));

  // 4. Not found error (404 NOT_FOUND) on unknown API route
  const notFoundRes = await fetch(`${baseUrl}/api/v1/non-existent-resource`);
  assert.equal(notFoundRes.status, 404);
  const notFoundBody = await notFoundRes.json();
  assert.equal(notFoundBody.code, "NOT_FOUND");
  assert.equal(notFoundBody.requestId, notFoundRes.headers.get("x-request-id"));

  // 5. Internal server error (500 INTERNAL_ERROR) hides SQL, stack traces, paths, and PII
  const { baseUrl: failingBaseUrl } = await withServer(t, {
    database: {
      async init() {},
      async getCustomBooks() { return []; },
      async getCatalogBookOverrides() { return []; },
      async getCoupons() {
        const err = new Error('SELECT * FROM coupons failed: duplicate key value at C:\\Users\\admin\\db.js:42:9 for secret@example.com');
        err.stack = 'Error: SQL failure\n    at PostgresDatabase.query (C:\\Users\\admin\\backend\\postgres-db.js:99:11)';
        throw err;
      },
      async close() {},
    },
  });
  const serverErrRes = await fetch(`${failingBaseUrl}/api/v1/coupons/BOOKNEST10`, {
    headers: { "X-Request-Id": "corr-500-check" },
  });
  assert.equal(serverErrRes.status, 500);
  assert.equal(serverErrRes.headers.get("x-request-id"), "corr-500-check");
  const serverErrText = await serverErrRes.text();
  assert.doesNotMatch(serverErrText, /SELECT|duplicate key|postgres-db|Users|secret@example\.com|stack/i);
  const serverErrBody = JSON.parse(serverErrText);
  assert.deepEqual(serverErrBody, {
    error: GENERIC_SERVER_ERROR_MESSAGE,
    code: "INTERNAL_ERROR",
    requestId: "corr-500-check",
  });
});
