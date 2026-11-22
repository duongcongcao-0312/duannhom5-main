"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  PAYLOAD_SCHEMAS,
  VALIDATION_POLICY,
  ValidationError,
  validateJsonPayload,
  validateQueryParams,
} = require("../backend/validation");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "validation-admin-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-validation-std-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    categoriesPath: path.join(directory, "categories.json"),
    authorsPath: path.join(directory, "authors.json"),
    publishersPath: path.join(directory, "publishers.json"),
    couponsPath: path.join(directory, "coupons.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
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

test("centralized validator enforces types, boundaries, enums, unknown fields, and prototype pollution rules", () => {
  assert.equal(VALIDATION_POLICY.errorCode, "VALIDATION_ERROR");
  // Verify previously nested coupon schemas are top-level
  assert.ok(PAYLOAD_SCHEMAS.coupon);
  assert.ok(PAYLOAD_SCHEMAS.couponUpdate);
  assert.ok(PAYLOAD_SCHEMAS.couponToggle);
  assert.ok(PAYLOAD_SCHEMAS.category);
  assert.ok(PAYLOAD_SCHEMAS.author);
  assert.ok(PAYLOAD_SCHEMAS.publisher);

  // Rejects non-objects, unknown fields, missing required fields, and minProperties violations
  assert.throws(
    () => validateJsonPayload([], PAYLOAD_SCHEMAS.login),
    (err) => err instanceof ValidationError && err.status === 400 && err.details[0].reason === "expected_object",
  );
  assert.throws(
    () => validateJsonPayload({ email: "a@example.com", password: "secret", extra: true }, PAYLOAD_SCHEMAS.login),
    (err) => err instanceof ValidationError && err.details[0].field === "extra" && err.details[0].reason === "unexpected_field",
  );
  assert.throws(
    () => validateJsonPayload({ email: "a@example.com" }, PAYLOAD_SCHEMAS.login),
    (err) => err instanceof ValidationError && err.details[0].field === "password" && err.details[0].reason === "required",
  );
  assert.throws(
    () => validateJsonPayload({}, PAYLOAD_SCHEMAS.bookUpdate),
    (err) => err instanceof ValidationError && err.details[0].reason === "min_properties",
  );

  // Rejects prototype-pollution keys
  const protoPayload = JSON.parse('{"email":"a@example.com","password":"secret","__proto__":{"isAdmin":true}}');
  assert.throws(
    () => validateJsonPayload(protoPayload, PAYLOAD_SCHEMAS.login),
    (err) => err instanceof ValidationError && err.details[0].reason === "forbidden_key",
  );
  assert.throws(
    () => validateJsonPayload({ title: "Book", price: 1000, constructor: {} }, PAYLOAD_SCHEMAS.book),
    (err) => err instanceof ValidationError && err.details[0].reason === "forbidden_key",
  );

  // Rejects non-finite numbers and numeric range violations
  assert.throws(
    () => validateJsonPayload({ title: "Book", price: Number.NaN }, PAYLOAD_SCHEMAS.book),
    (err) => err instanceof ValidationError && err.details[0].field === "price" && err.details[0].reason === "invalid_type",
  );
  assert.throws(
    () => validateJsonPayload({ title: "Book", price: -100 }, PAYLOAD_SCHEMAS.book),
    (err) => err instanceof ValidationError && err.details[0].field === "price" && err.details[0].reason === "min_value",
  );

  // Enforces string length, array length, and enum boundaries
  assert.throws(
    () => validateJsonPayload({ title: "x".repeat(241), price: 50000 }, PAYLOAD_SCHEMAS.book),
    (err) => err instanceof ValidationError && err.details[0].field === "title" && err.details[0].reason === "max_length",
  );
  assert.throws(
    () => validateJsonPayload({ items: [] }, PAYLOAD_SCHEMAS.orderQuote),
    (err) => err instanceof ValidationError && err.details[0].field === "items" && err.details[0].reason === "min_items",
  );
  assert.throws(
    () => validateJsonPayload({ status: "invalid_status" }, PAYLOAD_SCHEMAS.serviceStatus),
    (err) => err instanceof ValidationError && err.details[0].field === "status" && err.details[0].reason === "invalid_enum",
  );

  // Query parameter validation produces structured ValidationError
  assert.throws(
    () => validateQueryParams(new URL("http://localhost/api/books?unknown=1"), { page: { type: "integer", maxLength: 5, min: 1, max: 100 } }),
    (err) => err instanceof ValidationError && err.details[0].reason === "unexpected_query_param",
  );
  assert.throws(
    () => validateQueryParams(new URL("http://localhost/api/books?page=1&page=2"), { page: { type: "integer", maxLength: 5, min: 1, max: 100 } }),
    (err) => err instanceof ValidationError && err.details[0].reason === "duplicate_query_param",
  );
});

test("HTTP API returns standardized VALIDATION_ERROR without leaking sensitive values or mutating state", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // Login as admin
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "validation-admin-password-123",
    }),
  });
  assert.equal(loginRes.status, 200);
  const { token: adminToken } = await loginRes.json();
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  };

  // Sensitive field value (password) is never echoed in validation error response
  const secretPassword = "SuperSecretPasswordShouldNeverLeak!999";
  const badRegister = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      email: "user@example.com",
      password: secretPassword,
      role: "admin", // unexpected field!
    }),
  });
  assert.equal(badRegister.status, 400);
  const badRegisterText = await badRegister.text();
  assert.doesNotMatch(badRegisterText, new RegExp(secretPassword));
  const badRegisterJson = JSON.parse(badRegisterText);
  assert.equal(badRegisterJson.code, "VALIDATION_ERROR");
  assert.deepEqual(badRegisterJson.details, [{ field: "role", reason: "unexpected_field" }]);

  // Coupon endpoint (previously missing top-level schema) now strictly rejects unknown fields & out-of-range rate
  const badCouponUnknown = await fetch(`${baseUrl}/api/v1/admin/coupons`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      code: "TEST10",
      label: "Test",
      rate: 0.1,
      minSubtotal: 0,
      maxUses: 10,
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      enabled: true,
      injectedField: "bad",
    }),
  });
  assert.equal(badCouponUnknown.status, 400);
  const badCouponJson = await badCouponUnknown.json();
  assert.equal(badCouponJson.code, "VALIDATION_ERROR");
  assert.deepEqual(badCouponJson.details, [{ field: "injectedField", reason: "unexpected_field" }]);

  const badCouponRate = await fetch(`${baseUrl}/api/v1/admin/coupons`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      code: "TEST99",
      label: "Too High",
      rate: 0.9,
      minSubtotal: 0,
      maxUses: 10,
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      enabled: true,
    }),
  });
  assert.equal(badCouponRate.status, 400);
  assert.equal((await badCouponRate.json()).details[0].field, "rate");

  // Categories, authors, publishers now reject unexpected fields & invalid status without mutating data
  for (const endpoint of ["/api/v1/admin/categories", "/api/v1/admin/authors", "/api/v1/admin/publishers"]) {
    const resUnknown = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Valid Name", unexpectedProp: 123 }),
    });
    assert.equal(resUnknown.status, 400, `${endpoint} should reject unknown field`);
    assert.equal((await resUnknown.json()).code, "VALIDATION_ERROR");

    const resBadStatus = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Valid Name", status: "deleted_invalid" }),
    });
    assert.equal(resBadStatus.status, 400, `${endpoint} should reject invalid status`);
    assert.equal((await resBadStatus.json()).details[0].reason, "invalid_enum");
  }

  // Prototype pollution JSON body rejected with 400 (never 500)
  const protoRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"customerName":"Test","address":"12 Đường Sách","phone":"0901234567","paymentMethod":"cod","items":[{"title":"Nhà giả kim","quantity":1}],"__proto__":{"polluted":true}}',
  });
  assert.equal(protoRes.status, 400);
  assert.equal((await protoRes.json()).code, "VALIDATION_ERROR");
});
