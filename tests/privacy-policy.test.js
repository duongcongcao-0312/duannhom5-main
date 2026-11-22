const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { PRIVACY_POLICY } = require("../backend/privacy-policy");

const root = path.join(__dirname, "..");

test("privacy policy page covers data inventory, cookies/analytics, third parties, retention, rights, channels, version, and effective date", () => {
  const privacyHtml = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(privacyHtml, /Chính sách quyền riêng tư/);
  assert.match(privacyHtml, /Phiên bản 2026-01/);
  assert.match(privacyHtml, /01\/01\/2026/);

  for (const sectionId of [
    "privacyDataInventory",
    "privacyCookiesAnalytics",
    "privacyThirdParties",
    "privacyRetentionAndRights",
    "profileUpdatePolicy",
    "profileExportPolicy",
    "privacyRequestProcedure",
    "consentManagement",
    "privacyExportSection",
    "privacySecurity",
    "privacyChanges",
  ]) {
    assert.match(
      privacyHtml,
      new RegExp(`id="${sectionId}"`),
      `privacy.html must include #${sectionId}`,
    );
  }

  assert.match(privacyHtml, /localStorage/);
  assert.match(privacyHtml, /sessionStorage/);
  assert.match(privacyHtml, /Google Analytics/);
  assert.match(privacyHtml, /Firebase Authentication/);
  assert.match(privacyHtml, /VietQR/);
  assert.match(privacyHtml, /SePay/);
  assert.match(privacyHtml, /48 giờ/);
  assert.match(privacyHtml, /72 giờ/);
  assert.match(privacyHtml, /7 ngày/);
  assert.match(privacyHtml, /href="terms\.html"/);
  assert.match(privacyHtml, /href="shipping\.html"/);
  assert.match(privacyHtml, /href="returns\.html"/);
  assert.match(privacyHtml, /href="refund\.html"/);

  const consentScript = fs.readFileSync(
    path.join(root, "assets", "privacy-consent.js"),
    "utf8",
  );
  assert.match(
    consentScript,
    new RegExp(`POLICY_VERSION\\s*=\\s*['"]${PRIVACY_POLICY.version}['"]`),
    "privacy-consent.js POLICY_VERSION must match PRIVACY_POLICY.version",
  );

  const procedureDoc = fs.readFileSync(
    path.join(root, "docs", "privacy-policy-procedure.md"),
    "utf8",
  );
  assert.match(procedureDoc, /GET \/api\/policies\/privacy/);
  assert.match(procedureDoc, /privacy-request-procedure\.md/);
});

test("public privacy policy API returns structured inventory, cookie disclosure, providers, rights, and linked policies", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-privacy-policy-test-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    auditLogPath: path.join(temporaryDirectory, "audit.jsonl"),
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

  const res = await fetch(`${baseUrl}/api/policies/privacy`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.policy.version, PRIVACY_POLICY.version);
  assert.equal(body.policy.effectiveDate, "2026-01-01");
  assert.equal(body.policy.changeNoticeDays, 7);
  assert.equal(body.policy.dataInventory.length, 5);
  assert.equal(body.policy.cookiesAndAnalytics.usesAdvertisingCookies, false);
  assert.equal(body.policy.cookiesAndAnalytics.usesThirdPartyAnalytics, false);
  assert.equal(body.policy.thirdPartyProviders.length, 4);
  assert.equal(body.policy.dataSubjectRights.length, 6);
  assert.deepEqual(body.policy.contactAndChannels.slaHours, {
    access: 48,
    update: 48,
    export: 48,
    delete: 72,
  });
  assert.deepEqual(body.policy.linkedPolicies, {
    terms: "/terms.html",
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
  });
});
