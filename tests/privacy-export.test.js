const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  PrivacyExportStore,
  buildPersonalDataExport,
} = require("../backend/privacy-export");

test("buildPersonalDataExport includes owned data and excludes sensitive and third-party fields", () => {
  const doc = buildPersonalDataExport({
    user: {
      id: "user-1",
      name: "Nguyễn Văn A",
      email: "a@example.com",
      password: "scrypt$secret-hash",
      passwordAuthEnabled: true,
      passwordReset: { tokenHash: "reset-hash", expiresAt: "2026-12-01T00:00:00.000Z" },
      role: "user",
      studentType: "university",
      studentId: "SV12345",
      studentVerification: {
        status: "verified",
        requestedAt: "2026-11-01T00:00:00.000Z",
        verifiedAt: "2026-11-02T00:00:00.000Z",
        verifiedBy: "admin-internal-id",
      },
      authProvider: "google.com",
      providerId: "google-raw-uid-999",
      socialAccounts: [{ provider: "google.com", providerId: "google-raw-uid-999" }],
      customerInfo: {
        phone: "0901234567",
        address: "12 Lê Lợi, Quận 1, TP.HCM",
        internalNote: "do-not-export",
      },
      createdBy: "system",
      updatedBy: "staff-9",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-02T00:00:00.000Z",
    },
    orders: [
      {
        orderId: "ord-owned",
        userId: "user-1",
        createdAt: "2026-11-10T00:00:00.000Z",
        status: "confirmed",
        paymentStatus: "paid",
        paymentMethod: "transfer",
        paymentCode: "BN1234567890AB",
        couponCode: "SAVE10",
        subtotal: 100000,
        discount: 10000,
        total: 90000,
        customerName: "Nguyễn Văn A",
        phone: "0901234567",
        address: "12 Lê Lợi, Quận 1, TP.HCM",
        accessCodeHash: "secret-access-hash",
        idempotencyKey: "idem-secret-1",
        updatedBy: "sales-staff-1",
        items: [{ title: "Clean Code", quantity: 1, lineTotal: 100000 }],
      },
      {
        orderId: "ord-guest",
        userId: null,
        customerName: "Khách Vãng Lai",
        phone: "0901234567",
        address: "99 Guest Street",
        items: [],
      },
      {
        orderId: "ord-other",
        userId: "user-2",
        customerName: "Người Khác",
        phone: "0909999999",
        address: "88 Other Street",
        items: [],
      },
    ],
    consents: [
      {
        id: "c-1",
        subjectId: "user-1",
        purpose: "marketing",
        consent: true,
        policyVersion: "2026-01",
        dataSource: "web",
        retentionDays: 30,
        createdAt: "2026-11-05T00:00:00.000Z",
      },
      {
        id: "c-other",
        subjectId: "user-2",
        purpose: "order",
        consent: true,
        policyVersion: "2026-01",
      },
    ],
    dataRequests: [
      {
        id: "req-1",
        subjectId: "user-1",
        type: "access",
        status: "completed",
        createdBy: "user-1",
        updatedBy: "admin-secret-id",
        createdAt: "2026-11-06T00:00:00.000Z",
        updatedAt: "2026-11-07T00:00:00.000Z",
        resolvedAt: "2026-11-07T00:00:00.000Z",
      },
      {
        id: "req-other",
        subjectId: "user-2",
        type: "delete",
        status: "pending",
      },
    ],
  });

  assert.equal(doc.account.email, "a@example.com");
  assert.deepEqual(doc.account.linkedSocialProviders, ["google.com"]);
  assert.equal(doc.customerInfo.phone, "0901234567");
  assert.equal(doc.customerInfo.internalNote, undefined);
  assert.equal(doc.orders.length, 1);
  assert.equal(doc.orders[0].orderId, "ord-owned");
  assert.equal(doc.consents.length, 1);
  assert.equal(doc.consents[0].id, "c-1");
  assert.equal(doc.privacyDataRequests.length, 1);
  assert.equal(doc.privacyDataRequests[0].id, "req-1");

  const serialized = JSON.stringify(doc);
  assert.doesNotMatch(
    serialized,
    /scrypt\$secret-hash|reset-hash|google-raw-uid-999|admin-internal-id|staff-9|do-not-export|secret-access-hash|idem-secret-1|sales-staff-1|ord-guest|ord-other|c-other|req-other|admin-secret-id/,
  );
});

test("PrivacyExportStore enforces active uniqueness, ownership, token validation, and expiration", () => {
  let currentTime = 1_700_000_000_000;
  const store = new PrivacyExportStore({
    ttlMs: 1000,
    now: () => currentTime,
  });

  const first = store.createExport("user-1", { account: { id: "user-1" }, orders: [], consents: [], privacyDataRequests: [] });
  assert.equal(first.conflict, false);
  assert.ok(first.downloadToken);

  const duplicate = store.createExport("user-1", { account: { id: "user-1" } });
  assert.equal(duplicate.conflict, true);

  assert.equal(store.getDownload(first.record.id, "user-2", first.downloadToken).status, "forbidden");
  assert.equal(store.getDownload(first.record.id, "user-1", "wrong-token").status, "invalid_token");

  const ok = store.getDownload(first.record.id, "user-1", first.downloadToken);
  assert.equal(ok.status, "ok");
  assert.equal(ok.downloadCount, 1);

  currentTime += 1500;
  assert.equal(store.getDownload(first.record.id, "user-1", first.downloadToken).status, "expired");

  const afterExpiry = store.createExport("user-1", { account: { id: "user-1" } });
  assert.equal(afterExpiry.conflict, false);
  store.close();
});

test("privacy exports API enforces auth, identity verification, ownership, expiry, duplicate protection, and minimal audit logs", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-privacy-export-test-"),
  );
  const auditLogPath = path.join(temporaryDirectory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    consentRecordsPath: path.join(temporaryDirectory, "consents.json"),
    privacyDataRequestsPath: path.join(temporaryDirectory, "privacy-requests.json"),
    auditLogPath,
    privacyExportTtlMs: 60_000,
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

  async function register(name, email, password) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    assert.equal(res.status, 201);
    return res.json();
  }

  const owner = await register("Owner Reader", "owner-export@example.com", "ownerPassword123!");
  const other = await register("Other Reader", "other-export@example.com", "otherPassword123!");

  // Populate owner data: profile, consent, privacy data request, and owned order
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/customer-info`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        phone: "0908111222",
        address: "100 Nguyễn Huệ, Quận 1, TP.HCM",
      }),
    })).status,
    200,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/privacy/consents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        purpose: "order",
        policyVersion: "2026-01",
        dataSource: "web",
        consent: true,
        retentionDays: 90,
      }),
    })).status,
    201,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/privacy/data-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ type: "access" }),
    })).status,
    201,
  );

  // Unauthenticated access rejected
  assert.equal((await fetch(`${baseUrl}/api/privacy/exports`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/privacy/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "json" }),
    })).status,
    401,
  );

  // Forged owner field rejected
  assert.equal(
    (await fetch(`${baseUrl}/api/privacy/exports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ userId: other.user.id, currentPassword: "ownerPassword123!" }),
    })).status,
    400,
  );

  // Unsupported format rejected
  const badFormatRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({ format: "csv", currentPassword: "ownerPassword123!" }),
  });
  assert.equal(badFormatRes.status, 400);
  assert.equal((await badFormatRes.json()).code, "UNSUPPORTED_FORMAT");

  // Missing password -> 428 REAUTH_REQUIRED
  const missingPwRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({ format: "json" }),
  });
  assert.equal(missingPwRes.status, 428);
  assert.equal((await missingPwRes.json()).code, "REAUTH_REQUIRED");

  // Wrong password -> 401
  const wrongPwRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: "wrong-password" }),
  });
  assert.equal(wrongPwRes.status, 401);

  // Valid request -> 201 with one-time downloadToken
  const createRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: "ownerPassword123!" }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).export;
  assert.ok(created.id);
  assert.ok(created.downloadToken);
  assert.equal(created.format, "json");

  // Repeated request while active -> 409 EXPORT_ALREADY_ACTIVE
  const duplicateRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: "ownerPassword123!" }),
  });
  assert.equal(duplicateRes.status, 409);
  assert.equal((await duplicateRes.json()).code, "EXPORT_ALREADY_ACTIVE");

  // List endpoint returns metadata only (no downloadToken) and isolates users
  const ownerList = await (await fetch(`${baseUrl}/api/privacy/exports`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  })).json();
  assert.equal(ownerList.exports.length, 1);
  assert.equal(ownerList.exports[0].downloadToken, undefined);

  const otherList = await (await fetch(`${baseUrl}/api/privacy/exports`, {
    headers: { Authorization: `Bearer ${other.token}` },
  })).json();
  assert.equal(otherList.exports.length, 0);

  // Download without token -> 403 INVALID_EXPORT_TOKEN
  const noTokenDownload = await fetch(`${baseUrl}${created.downloadUrl}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(noTokenDownload.status, 403);
  assert.equal((await noTokenDownload.json()).code, "INVALID_EXPORT_TOKEN");

  // Other user trying to download even with stolen token -> 403 FORBIDDEN
  const otherDownload = await fetch(`${baseUrl}${created.downloadUrl}`, {
    headers: {
      Authorization: `Bearer ${other.token}`,
      "X-Export-Token": created.downloadToken,
    },
  });
  assert.equal(otherDownload.status, 403);
  assert.equal((await otherDownload.json()).code, "FORBIDDEN");

  // Owner downloads valid export
  const downloadRes = await fetch(`${baseUrl}${created.downloadUrl}`, {
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "X-Export-Token": created.downloadToken,
    },
  });
  assert.equal(downloadRes.status, 200);
  assert.match(downloadRes.headers.get("content-disposition") || "", /^attachment; filename="booknest-personal-data-/);
  assert.equal(downloadRes.headers.get("cache-control"), "no-store, private");
  const exportedJson = await downloadRes.json();
  assert.equal(exportedJson.account.email, "owner-export@example.com");
  assert.equal(exportedJson.customerInfo.phone, "0908111222");
  assert.equal(exportedJson.consents.length, 1);
  assert.equal(exportedJson.privacyDataRequests.length, 1);
  assert.equal(exportedJson.account.password, undefined);
  assert.doesNotMatch(JSON.stringify(exportedJson), /other-export@example\.com|ownerPassword123!/);

  // Audit log records create & download events without any PII, password, or downloadToken
  const auditText = await fsPromises.readFile(auditLogPath, "utf8");
  const auditEntries = auditText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(auditEntries.some((entry) => entry.action === "privacy.export.create"));
  assert.ok(auditEntries.some((entry) => entry.action === "privacy.export.download"));
  assert.doesNotMatch(
    auditText,
    new RegExp(`owner-export@example\\.com|0908111222|Nguyễn Huệ|ownerPassword123!|${created.downloadToken}`),
  );
});

test("privacy export download link expires with 410 and then allows a fresh export", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-privacy-export-expiry-test-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    consentRecordsPath: path.join(temporaryDirectory, "consents.json"),
    privacyDataRequestsPath: path.join(temporaryDirectory, "privacy-requests.json"),
    auditLogPath: path.join(temporaryDirectory, "audit.jsonl"),
    privacyExportTtlMs: 50,
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

  const reg = await (await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Expiry Reader",
      email: "expiry-export@example.com",
      password: "expiryPassword123!",
    }),
  })).json();

  const createRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${reg.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: "expiryPassword123!" }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).export;

  await new Promise((resolve) => setTimeout(resolve, 100));

  const expiredRes = await fetch(`${baseUrl}${created.downloadUrl}`, {
    headers: {
      Authorization: `Bearer ${reg.token}`,
      "X-Export-Token": created.downloadToken,
    },
  });
  assert.equal(expiredRes.status, 410);
  assert.equal((await expiredRes.json()).code, "EXPORT_EXPIRED");

  const recreatedRes = await fetch(`${baseUrl}/api/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${reg.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: "expiryPassword123!" }),
  });
  assert.equal(recreatedRes.status, 201);
});
