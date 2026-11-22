"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  API_VERSION_POLICY,
  CURRENT_API_VERSION,
  LEGACY_ALIAS_SUNSET_HTTP_DATE,
  SUPPORTED_API_VERSIONS,
  resolveApiVersion,
} = require("../backend/api-versioning");
const { findRoute, getAdminPermission } = require("../backend/router");
const { ENDPOINT_BODY_LIMITS, resolveRequestBodyLimit } = require("../backend/request-limits");
const { readAuditEntries } = require("../backend/audit");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "versioning-admin-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-versioning-"));
  const auditLogPath = path.join(directory, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    auditLogPath,
    uploadsDir: path.join(directory, "uploads"),
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
  };
}

test("resolveApiVersion, router, and request limits maintain exact parity across /api/v1/* and legacy /api/*", () => {
  assert.deepEqual(resolveApiVersion("/api/v1/books"), {
    isApi: true,
    version: "v1",
    isVersioned: true,
    isLegacyAlias: false,
    unsupportedVersion: null,
    canonicalPath: "/api/books",
    versionedPath: "/api/v1/books",
  });
  assert.deepEqual(resolveApiVersion("/api/books"), {
    isApi: true,
    version: "v1",
    isVersioned: false,
    isLegacyAlias: true,
    unsupportedVersion: null,
    canonicalPath: "/api/books",
    versionedPath: "/api/v1/books",
  });
  assert.equal(resolveApiVersion("/api/v2/books").unsupportedVersion, "v2");
  assert.equal(resolveApiVersion("/api/v0/orders").unsupportedVersion, "v0");
  assert.equal(resolveApiVersion("/health").isApi, false);

  // Router parity & RBAC preservation
  assert.equal(findRoute("/api/v1/version", "GET")?.name, "version");
  assert.equal(findRoute("/api/v1/books", "GET")?.name, "books");
  assert.equal(findRoute("/api/v2/books", "GET"), null);

  assert.equal(getAdminPermission("/api/v1/admin/books", "GET"), "read:books");
  assert.equal(getAdminPermission("/api/v1/admin/books", "POST"), "write:books");
  assert.equal(getAdminPermission("/api/v1/admin/audit", "GET"), "read:audit");
  assert.equal(getAdminPermission("/api/v1/admin/uploads/book-cover", "POST"), "write:books");
  assert.equal(getAdminPermission("/api/v2/admin/audit", "GET"), null);

  // Request size limit parity
  assert.equal(resolveRequestBodyLimit("/api/v1/auth/login").maxBytes, ENDPOINT_BODY_LIMITS.auth);
  assert.equal(resolveRequestBodyLimit("/api/v1/payments/webhook").maxBytes, ENDPOINT_BODY_LIMITS.webhooks);
  assert.equal(resolveRequestBodyLimit("/api/v1/admin/books").maxBytes, ENDPOINT_BODY_LIMITS.admin);
  assert.equal(resolveRequestBodyLimit("/api/v1/admin/uploads/book-cover").maxBytes, ENDPOINT_BODY_LIMITS.upload);
});

test("HTTP server routes /api/v1/* cleanly, annotates legacy /api/* with deprecation headers, and rejects unsupported versions", async (t) => {
  const { baseUrl } = await withServer(t);

  // Canonical versioned endpoint: X-API-Version present, no Deprecation header
  const versionRes = await fetch(`${baseUrl}/api/v1/version`);
  assert.equal(versionRes.status, 200);
  assert.equal(versionRes.headers.get("x-api-version"), CURRENT_API_VERSION);
  assert.equal(versionRes.headers.get("deprecation"), null);
  assert.equal(versionRes.headers.get("sunset"), null);
  const versionPayload = await versionRes.json();
  assert.equal(versionPayload.currentVersion, CURRENT_API_VERSION);
  assert.deepEqual(versionPayload.supportedVersions, [...SUPPORTED_API_VERSIONS]);
  assert.equal(versionPayload.minSupportWindowDays, API_VERSION_POLICY.minSupportWindowDays);

  const v1Books = await fetch(`${baseUrl}/api/v1/books?limit=5`);
  assert.equal(v1Books.status, 200);
  assert.equal(v1Books.headers.get("x-api-version"), CURRENT_API_VERSION);
  assert.equal(v1Books.headers.get("deprecation"), null);
  assert.ok(Array.isArray(await v1Books.json()));

  // Legacy unversioned alias: still works, includes Deprecation + Sunset + Link headers
  const legacyBooks = await fetch(`${baseUrl}/api/books?limit=5`);
  assert.equal(legacyBooks.status, 200);
  assert.equal(legacyBooks.headers.get("x-api-version"), CURRENT_API_VERSION);
  assert.equal(legacyBooks.headers.get("deprecation"), "true");
  assert.equal(legacyBooks.headers.get("sunset"), LEGACY_ALIAS_SUNSET_HTTP_DATE);
  assert.equal(legacyBooks.headers.get("link"), '</api/v1/books>; rel="successor-version"');

  // Operational probes remain unversioned
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("deprecation"), null);

  // Unsupported versions rejected with 404 UNSUPPORTED_API_VERSION
  for (const unsupportedPath of ["/api/v2/books", "/api/v0/orders", "/api/v99/admin/audit"]) {
    const res = await fetch(`${baseUrl}${unsupportedPath}`);
    assert.equal(res.status, 404, unsupportedPath);
    assert.equal(res.headers.get("x-api-version"), CURRENT_API_VERSION);
    const body = await res.json();
    assert.equal(body.code, "UNSUPPORTED_API_VERSION");
  }
});

test("versioned /api/v1/* endpoints enforce identical RBAC, audit logging, and request limits", async (t) => {
  configureAdminEnv(t);
  const { baseUrl, auditLogPath } = await withServer(t);

  // Unauthenticated admin audit call on /api/v1/admin/audit -> 401 + audited
  const unauthAudit = await fetch(`${baseUrl}/api/v1/admin/audit`);
  assert.equal(unauthAudit.status, 401);
  assert.equal(unauthAudit.headers.get("x-api-version"), CURRENT_API_VERSION);

  // Regular user registered via /api/v1/auth/register -> 201, blocked from /api/v1/admin/audit -> 403
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Versioned Reader",
      email: "v1-reader@example.com",
      password: "v1-reader-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: userToken } = await regRes.json();

  const forbiddenAudit = await fetch(`${baseUrl}/api/v1/admin/audit`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.equal(forbiddenAudit.status, 403);

  // Oversized /api/v1/auth/login -> 413 with 16 KiB auth limit
  const oversizedAuth = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "x".repeat(ENDPOINT_BODY_LIMITS.auth + 100),
    }),
  });
  assert.equal(oversizedAuth.status, 413);
  assert.equal((await oversizedAuth.json()).maxBytes, ENDPOINT_BODY_LIMITS.auth);

  // Admin login via /api/v1/auth/login -> 200
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "versioning-admin-password-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  // Admin can read /api/v1/admin/audit (200) and mutations stay blocked (405)
  const adminAudit = await fetch(`${baseUrl}/api/v1/admin/audit`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminAudit.status, 200);
  const deleteAudit = await fetch(`${baseUrl}/api/v1/admin/audit`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteAudit.status, 405);

  // Verify denied /api/v1/admin/audit attempts were recorded in the audit log
  const entries = await readAuditEntries(auditLogPath);
  assert.ok(entries.some((e) => e.action === "admin.api.denied" && e.entityId === "/api/admin/audit" && e.statusCode === 401));
  assert.ok(entries.some((e) => e.action === "admin.api.denied" && e.entityId === "/api/admin/audit" && e.statusCode === 403));

  // Order creation and access-code privacy work via /api/v1/orders
  const accessCode = "b2".repeat(32);
  const createOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Khách V1",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode,
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(createOrder.status, 201);
  const order = await createOrder.json();

  const noCodeLookup = await fetch(`${baseUrl}/api/v1/orders/${order.orderId}`);
  assert.equal(noCodeLookup.status, 404);
  const validLookup = await fetch(`${baseUrl}/api/v1/orders/${order.orderId}`, {
    headers: { "X-Order-Access-Code": accessCode },
  });
  assert.equal(validLookup.status, 200);
});
