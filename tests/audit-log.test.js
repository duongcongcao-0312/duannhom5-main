const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createServer } = require("../server");
const {
  AUDIT_POLICY,
  appendAuditEntry,
  readAuditEntries,
  sanitizeAuditValue,
} = require("../backend/audit");
const { hasPermission } = require("../backend/authorization");

const previousAdminEnvironment = {
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

after(() => {
  for (const [key, value] of Object.entries(previousAdminEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureTestAdmin() {
  process.env.ADMIN_EMAIL = "admin-audit@example.com";
  process.env.ADMIN_PASSWORD = "local-test-admin-password-123";
}

test("audit policy defines retention, minimum fields, immutability, and admin-only read:audit permission", () => {
  assert.equal(AUDIT_POLICY.retentionDays, 365);
  for (const field of [
    "id",
    "timestamp",
    "action",
    "actorId",
    "actorRole",
    "entityType",
    "entityId",
    "outcome",
    "statusCode",
    "requestId",
  ]) {
    assert.ok(AUDIT_POLICY.minimumFields.includes(field));
  }
  assert.equal(hasPermission({ role: "admin" }, "read:audit"), true);
  assert.equal(hasPermission({ role: "sales" }, "read:audit"), false);
  assert.equal(hasPermission({ role: "support" }, "read:audit"), false);
  assert.equal(hasPermission({ role: "user" }, "read:audit"), false);
});

test("sanitizeAuditValue strips secrets, credentials, and personal fields and detects log tampering", async (t) => {
  const sanitized = sanitizeAuditValue({
    action: "staff.profile.create",
    password: "super-secret-password",
    accessToken: "eyJhbGciOiJIUzI1NiJ9.secret",
    apiKey: "sk-live-123456",
    cookie: "sid=abc",
    email: "private@example.com",
    phone: "0901234567",
    address: "123 Secret Street",
    note: "Internal PII note",
    safeStatus: "active",
    message: "Authorization: Bearer my-secret-token-value",
  });
  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.accessToken, undefined);
  assert.equal(sanitized.apiKey, undefined);
  assert.equal(sanitized.cookie, undefined);
  assert.equal(sanitized.email, undefined);
  assert.equal(sanitized.phone, undefined);
  assert.equal(sanitized.address, undefined);
  assert.equal(sanitized.note, undefined);
  assert.equal(sanitized.safeStatus, "active");
  assert.doesNotMatch(sanitized.message, /my-secret-token-value/);

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-audit-tamper-"));
  t.after(() => fsPromises.rm(tempDir, { recursive: true, force: true }));
  const auditLogPath = path.join(tempDir, "admin-audit.jsonl");

  await appendAuditEntry(auditLogPath, {
    action: "coupon.create",
    actorId: "admin-1",
    actorRole: "admin",
    entityType: "coupon",
    entityId: "SAFE10",
    outcome: "success",
    statusCode: 201,
  });
  await appendAuditEntry(auditLogPath, {
    action: "coupon.update",
    actorId: "admin-1",
    actorRole: "admin",
    entityType: "coupon",
    entityId: "SAFE10",
    outcome: "success",
    statusCode: 200,
  });

  const entries = await readAuditEntries(auditLogPath);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].outcome, "success");
  assert.equal(entries[0].statusCode, 201);

  // Tamper with a logged field -> hash chain verification must fail.
  const raw = await fsPromises.readFile(auditLogPath, "utf8");
  await fsPromises.writeFile(auditLogPath, raw.replace("SAFE10", "TAMPER"), "utf8");
  await assert.rejects(
    readAuditEntries(auditLogPath),
    /hash validation failed|chain was broken/i,
  );
});

test("admin audit trail records success, failure, denied attempts, enforces read:audit access, and blocks mutations", async (t) => {
  configureTestAdmin();
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-audit-e2e-"));
  const auditLogPath = path.join(tempDir, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(tempDir, "orders.jsonl"),
    usersPath: path.join(tempDir, "users.json"),
    servicesPath: path.join(tempDir, "services.jsonl"),
    couponsPath: path.join(tempDir, "coupons.json"),
    booksPath: path.join(tempDir, "books.json"),
    auditLogPath,
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Login as admin
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  assert.equal(adminLoginRes.status, 200);
  const { token: adminToken } = await adminLoginRes.json();
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  // Provision a sales user to test denied access to /api/admin/audit and /api/admin/coupons
  const salesCreateRes = await fetch(`${baseUrl}/api/admin/staff`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Sales Audit Tester",
      email: "sales-audit@example.com",
      password: "sales-secret-password-123",
      role: "sales",
    }),
  });
  assert.equal(salesCreateRes.status, 201);

  const salesLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales-audit@example.com",
      password: "sales-secret-password-123",
    }),
  });
  assert.equal(salesLoginRes.status, 200);
  const { token: salesToken } = await salesLoginRes.json();
  const salesHeaders = {
    Authorization: `Bearer ${salesToken}`,
    "Content-Type": "application/json",
  };

  // 1. Unauthenticated access to /api/admin/audit -> 401 denied
  const unauthAuditRes = await fetch(`${baseUrl}/api/admin/audit`);
  assert.equal(unauthAuditRes.status, 401);

  // 2. Non-admin (sales) access to /api/admin/audit -> 403 denied
  const salesAuditRes = await fetch(`${baseUrl}/api/admin/audit`, {
    headers: salesHeaders,
  });
  assert.equal(salesAuditRes.status, 403);

  // 3. Admin cannot mutate or delete audit logs via API -> 405 Method Not Allowed
  const deleteAuditRes = await fetch(`${baseUrl}/api/admin/audit`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deleteAuditRes.status, 405);

  const patchAuditRes = await fetch(`${baseUrl}/api/admin/audit`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ action: "tamper" }),
  });
  assert.equal(patchAuditRes.status, 405);

  // 4. Successful admin mutation: create coupon -> 201 + coupon.create audit entry
  const couponCreateRes = await fetch(`${baseUrl}/api/admin/coupons`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      code: "AUDIT15",
      label: "Giảm 15% kiểm thử audit",
      rate: 0.15,
      minSubtotal: 100000,
      maxUses: 0,
      startsAt: "",
      expiresAt: "",
      enabled: true,
    }),
  });
  assert.equal(couponCreateRes.status, 201);

  // 5. Failed admin mutation: duplicate coupon -> 409 + admin.api.failure audit entry
  const dupCouponRes = await fetch(`${baseUrl}/api/admin/coupons`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      code: "AUDIT15",
      label: "Trùng mã",
      rate: 0.15,
      minSubtotal: 100000,
      maxUses: 0,
      startsAt: "",
      expiresAt: "",
      enabled: true,
    }),
  });
  assert.equal(dupCouponRes.status, 409);

  // 6. Query audit log as admin with filters
  const deniedAuditRes = await fetch(`${baseUrl}/api/admin/audit?outcome=denied`, {
    headers: adminHeaders,
  });
  assert.equal(deniedAuditRes.status, 200);
  const deniedBody = await deniedAuditRes.json();
  assert.equal(deniedBody.policy.retentionDays, 365);
  assert.ok(
    deniedBody.entries.some(
      (entry) =>
        entry.action === "admin.api.denied" &&
        entry.statusCode === 401 &&
        entry.entityId === "/api/admin/audit",
    ),
  );
  assert.ok(
    deniedBody.entries.some(
      (entry) =>
        entry.action === "admin.api.denied" &&
        entry.statusCode === 403 &&
        entry.actorRole === "sales" &&
        entry.entityId === "/api/admin/audit",
    ),
  );

  const failureAuditRes = await fetch(`${baseUrl}/api/admin/audit?outcome=failure`, {
    headers: adminHeaders,
  });
  assert.equal(failureAuditRes.status, 200);
  const failureBody = await failureAuditRes.json();
  assert.ok(
    failureBody.entries.some(
      (entry) =>
        entry.action === "admin.api.failure" &&
        entry.statusCode === 409 &&
        entry.entityId === "/api/admin/coupons",
    ),
  );
  assert.ok(
    failureBody.entries.some(
      (entry) =>
        entry.action === "admin.api.failure" &&
        entry.statusCode === 405 &&
        entry.entityId === "/api/admin/audit",
    ),
  );

  const couponAuditRes = await fetch(`${baseUrl}/api/admin/audit?action=coupon.create`, {
    headers: adminHeaders,
  });
  assert.equal(couponAuditRes.status, 200);
  const couponBody = await couponAuditRes.json();
  assert.equal(couponBody.entries.length, 1);
  assert.equal(couponBody.entries[0].entityId, "AUDIT15");
  assert.equal(couponBody.entries[0].outcome, "success");
  assert.equal(couponBody.entries[0].statusCode, 201);
  assert.equal(couponBody.entries[0].actorRole, "admin");

  // 7. Verify raw file contains no secrets or PII
  const rawAudit = await fsPromises.readFile(auditLogPath, "utf8");
  assert.doesNotMatch(
    rawAudit,
    /local-test-admin-password-123|sales-secret-password-123|sales-audit@example\.com|Sales Audit Tester/,
  );
  assert.doesNotMatch(rawAudit, new RegExp(adminToken));
  assert.doesNotMatch(rawAudit, new RegExp(salesToken));
});
