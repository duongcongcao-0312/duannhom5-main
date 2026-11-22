const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const {
  PRIVACY_DATA_REQUEST_TYPES,
  computePrivacyRequestDueAt,
  isPrivacyRequestOverdue,
} = require("../backend/privacy-data-requests");

test("DSAR policy computes internal SLA deadlines and overdue state per request type", () => {
  assert.deepEqual(PRIVACY_DATA_REQUEST_TYPES, ["access", "update", "export", "delete"]);
  const start = "2026-11-20T00:00:00.000Z";
  assert.equal(computePrivacyRequestDueAt("access", start), "2026-11-22T00:00:00.000Z");
  assert.equal(computePrivacyRequestDueAt("export", start), "2026-11-22T00:00:00.000Z");
  assert.equal(computePrivacyRequestDueAt("delete", start), "2026-11-23T00:00:00.000Z");

  assert.equal(
    isPrivacyRequestOverdue(
      { status: "pending", dueAt: "2026-11-22T00:00:00.000Z" },
      Date.parse("2026-11-22T01:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isPrivacyRequestOverdue(
      { status: "completed", dueAt: "2026-11-22T00:00:00.000Z" },
      Date.parse("2026-11-22T01:00:00.000Z"),
    ),
    false,
  );
});

test("DSAR workflow supports export requests, assignment, escalation, anonymization, session revocation, and minimal audit logs", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-dsar-workflow-test-"),
  );
  const usersPath = path.join(temporaryDirectory, "users.json");
  const privacyDataRequestsPath = path.join(temporaryDirectory, "privacy-requests.json");
  const auditLogPath = path.join(temporaryDirectory, "audit.jsonl");
  const db = new Database({ usersPath, privacyDataRequestsPath, auditLogPath });
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    consentRecordsPath: path.join(temporaryDirectory, "consents.json"),
    privacyDataRequestsPath,
    auditLogPath,
    database: db,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await db.init();
  const admin = await db.createUser({
    name: "Privacy Lead",
    email: "privacy-lead@example.com",
    password: "adminPassword123!",
    role: "admin",
  });
  const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: admin.email, password: "adminPassword123!" }),
  })).json();
  const adminHeaders = {
    Authorization: `Bearer ${adminLogin.token}`,
    "Content-Type": "application/json",
  };

  const userReg = await (await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Nguyễn Thị B",
      email: "user-dsar@example.com",
      password: "userPassword123!",
      studentType: "university",
      studentId: "SV998877",
    }),
  })).json();
  const userHeaders = {
    Authorization: `Bearer ${userReg.token}`,
    "Content-Type": "application/json",
  };

  // Save profile info so we can verify anonymization wipes it
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/customer-info`, {
      method: "PATCH",
      headers: userHeaders,
      body: JSON.stringify({
        phone: "0912345678",
        address: "45 Trần Hưng Đạo, Quận 1, TP.HCM",
      }),
    })).status,
    200,
  );

  // Create an export data request with SLA & verification metadata
  const exportReqRes = await fetch(`${baseUrl}/api/privacy/data-requests`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ type: "export", channel: "web_portal" }),
  });
  assert.equal(exportReqRes.status, 201);
  const exportReq = (await exportReqRes.json()).request;
  assert.equal(exportReq.type, "export");
  assert.equal(exportReq.channel, "web_portal");
  assert.equal(exportReq.verificationMethod, "session_token");
  assert.equal(exportReq.escalationLevel, "l1_support");
  assert.ok(exportReq.dueAt);
  assert.equal(exportReq.overdue, false);

  // Cannot execute anonymization on non-delete request
  const badAnonRes = await fetch(`${baseUrl}/api/admin/privacy/data-requests/${exportReq.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "completed", executeAnonymization: true }),
  });
  assert.equal(badAnonRes.status, 400);
  assert.equal((await badAnonRes.json()).code, "ANONYMIZATION_NOT_ALLOWED");

  // Assign & escalate the export request, then complete with resolutionCode
  const assignRes = await fetch(`${baseUrl}/api/admin/privacy/data-requests/${exportReq.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      status: "processing",
      assignedTo: "privacy-officer-1",
      escalationLevel: "l2_privacy_lead",
    }),
  });
  assert.equal(assignRes.status, 200);
  const assigned = (await assignRes.json()).request;
  assert.equal(assigned.assignedTo, "privacy-officer-1");
  assert.equal(assigned.escalationLevel, "l2_privacy_lead");

  // Filter admin queue by escalationLevel and inspect summary
  const filteredRes = await fetch(
    `${baseUrl}/api/admin/privacy/data-requests?escalationLevel=l2_privacy_lead`,
    { headers: adminHeaders },
  );
  assert.equal(filteredRes.status, 200);
  const filteredBody = await filteredRes.json();
  assert.equal(filteredBody.requests.length, 1);
  assert.equal(filteredBody.summary.processing, 1);

  // Create a delete request and complete it with executeAnonymization: true
  const deleteReqRes = await fetch(`${baseUrl}/api/privacy/data-requests`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ type: "delete" }),
  });
  assert.equal(deleteReqRes.status, 201);
  const deleteReq = (await deleteReqRes.json()).request;

  const completeDeleteRes = await fetch(
    `${baseUrl}/api/admin/privacy/data-requests/${deleteReq.id}`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: "completed",
        assignedTo: "privacy-officer-1",
        executeAnonymization: true,
      }),
    },
  );
  assert.equal(completeDeleteRes.status, 200);
  const completedDelete = await completeDeleteRes.json();
  assert.equal(completedDelete.anonymized, true);
  assert.equal(completedDelete.request.resolutionCode, "anonymized");

  // User's active session is immediately revoked
  const meAfterDelete = await fetch(`${baseUrl}/api/auth/me`, { headers: userHeaders });
  assert.equal(meAfterDelete.status, 401);

  // Stored user record is anonymized and deactivated
  const storedUser = await db.findUserById(userReg.user.id);
  assert.equal(storedUser.isActive, false);
  assert.equal(storedUser.passwordAuthEnabled, false);
  assert.equal(storedUser.name, "Tài khoản đã ẩn danh");
  assert.match(storedUser.email, /^deleted-.*@anonymized\.local$/);
  assert.deepEqual(storedUser.customerInfo, {});
  assert.equal(storedUser.studentId, "");

  // Audit log captures workflow actions with zero PII
  const auditText = await fsPromises.readFile(auditLogPath, "utf8");
  const auditEntries = auditText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(auditEntries.some((entry) => entry.action === "privacy.data_request.create"));
  assert.ok(auditEntries.some((entry) => entry.action === "privacy.data_request.update"));
  assert.ok(auditEntries.some((entry) => entry.action === "privacy.account.anonymize"));
  assert.doesNotMatch(
    auditText,
    /user-dsar@example\.com|0912345678|Trần Hưng Đạo|Nguyễn Thị B|SV998877|userPassword123!/,
  );
});
