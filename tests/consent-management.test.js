"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { CONSENT_POLICY } = require("../backend/consent-policy");

const root = path.join(__dirname, "..");

test("consent policy, UI, and procedure enforce unbundled opt-in defaults and versioned consent disclosure", () => {
  assert.equal(CONSENT_POLICY.purposes.length, 3);
  const marketing = CONSENT_POLICY.purposes.find((p) => p.purpose === "marketing");
  assert.ok(marketing);
  assert.equal(marketing.requiredForCoreService, false);
  assert.equal(marketing.defaultChecked, false);
  assert.equal(marketing.revocable, true);

  const privacyHtml = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(privacyHtml, /id="consentUnbundledNotice"/);
  for (const purpose of ["order", "service", "marketing"]) {
    // Checkboxes must exist and MUST NOT be pre-checked
    const checkboxMatch = privacyHtml.match(
      new RegExp(`<input[^>]*data-consent="${purpose}"[^>]*>`),
    );
    assert.ok(checkboxMatch, `privacy.html must include checkbox for ${purpose}`);
    assert.doesNotMatch(checkboxMatch[0], /\bchecked\b/i, `${purpose} consent checkbox must not be pre-checked`);
    assert.match(privacyHtml, new RegExp(`data-consent-save="${purpose}"`));
    assert.match(privacyHtml, new RegExp(`data-consent-revoke="${purpose}"`));
  }

  // Registration & checkout forms do not bundle optional marketing consent
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.doesNotMatch(indexHtml, /data-consent="marketing"[^>]*required/i);

  const doc = fs.readFileSync(
    path.join(root, "docs", "consent-management-procedure.md"),
    "utf8",
  );
  assert.match(doc, /không thay thế ý kiến tư vấn pháp lý/i);
  assert.match(doc, /marketing/);
  assert.match(doc, /policyVersion/);
  assert.match(doc, /DELETE \/api\/v1\/privacy\/consents/);
});

test("consent lifecycle records timestamp, scope, policyVersion, allows withdrawal, and never blocks core orders", async (t) => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-consent-mgmt-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Public consent policy API is accessible without auth
  for (const endpoint of ["/api/policies/consent", "/api/v1/policies/consent"]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.policy.version, CONSENT_POLICY.version);
    assert.equal(body.policy.purposes.length, 3);
  }

  // 2. Register and place an order WITHOUT granting marketing consent (unbundled guarantee)
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Consent User",
      email: "consent-user@example.com",
      password: "consent-user-pass-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token } = await regRes.json();

  const orderWithoutMarketing = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      customerName: "Consent User",
      address: "10 Đường Đồng Ý, Quận 1",
      phone: "0905111222",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderWithoutMarketing.status, 201);

  // 3. Grant marketing consent with policyVersion 2026-01 -> records timestamp, scope, version
  const grantRes = await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      purpose: "marketing",
      policyVersion: "2026-01",
      dataSource: "web",
      consent: true,
      retentionDays: 365,
    }),
  });
  assert.equal(grantRes.status, 201);
  const { record: granted } = await grantRes.json();
  assert.equal(granted.purpose, "marketing");
  assert.equal(granted.consent, true);
  assert.equal(granted.policyVersion, "2026-01");
  assert.ok(granted.createdAt);

  // 4. Revoke marketing consent -> appends revocation record & preserves full history
  const revokeRes = await fetch(
    `${baseUrl}/api/v1/privacy/consents/marketing?policyVersion=2026-01`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(revokeRes.status, 200);
  const { record: revoked } = await revokeRes.json();
  assert.equal(revoked.consent, false);
  assert.equal(revoked.policyVersion, "2026-01");

  const listRes = await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(listRes.status, 200);
  const listed = await listRes.json();
  assert.equal(listed.current.marketing.consent, false);
  assert.equal(listed.records.length, 2);
});
