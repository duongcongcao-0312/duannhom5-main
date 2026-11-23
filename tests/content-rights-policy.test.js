"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const books = require("../books-data");
const { createServer } = require("../server");
const {
  CONTENT_RIGHTS_POLICY,
  auditCatalogRights,
} = require("../backend/content-rights-policy");

const root = path.join(__dirname, "..");

test("catalog rights audit accurately inventories built-in book covers and flags external sources", () => {
  const audit = auditCatalogRights(books);
  assert.equal(audit.totalBooks, books.length);
  assert.equal(audit.typographicCoverCount + audit.externalCoverCount, books.length);
  assert.ok(audit.typographicCoverCount > 0);
  // Only known audited external host (covers.openlibrary.org) may appear in built-in catalog
  for (const host of Object.keys(audit.externalHosts)) {
    assert.equal(host, "covers.openlibrary.org", `Unexpected unaudited external cover host: ${host}`);
  }
  assert.equal(audit.booksNeedingClearance.length, audit.externalCoverCount);
});

test("content rights page and review dossier document inventory, attribution limits, takedown workflow, and disclaimer", () => {
  const html = fs.readFileSync(path.join(root, "content-rights.html"), "utf8");
  assert.match(html, /Bản quyền hình ảnh bìa &amp; nội dung sách/);
  for (const sectionId of [
    "rightsInventory",
    "rightsLicensingLimits",
    "rightsTakedownProcedure",
  ]) {
    assert.match(html, new RegExp(`id="${sectionId}"`), `content-rights.html must include #${sectionId}`);
  }
  assert.match(html, /covers\.openlibrary\.org/);
  assert.match(html, /24 giờ/);
  assert.match(html, /5 ngày làm việc/);
  assert.match(html, /5 năm/);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /<footer[\s\S]*href="content-rights\.html"/);

  const doc = fs.readFileSync(
    path.join(root, "docs", "content-rights-review.md"),
    "utf8",
  );
  assert.match(doc, /covers\.openlibrary\.org/);
  assert.match(doc, /Takedown/);
  assert.match(doc, /24 giờ/);
  assert.match(doc, /5 năm/);
});

test("public content-rights policy API and HTML page are accessible without authentication", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-content-rights-test-"),
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

  for (const endpoint of [
    "/api/policies/content-rights",
    "/api/v1/policies/content-rights",
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200, `${endpoint} must return 200`);
    const body = await res.json();
    assert.equal(body.policy.version, CONTENT_RIGHTS_POLICY.version);
    assert.equal(body.policy.policyUrl, "/content-rights.html");
    assert.equal(body.policy.assetCategories.length, 5);
    assert.equal(body.policy.takedownWorkflow.temporaryHideHours, 24);
    assert.equal(body.policy.takedownWorkflow.resolutionBusinessDays, 5);
    assert.equal(body.policy.takedownWorkflow.licenseRecordRetentionYears, 5);
  }

  const pageRes = await fetch(`${baseUrl}/content-rights.html`);
  assert.equal(pageRes.status, 200);
  assert.match(await pageRes.text(), /Bản quyền hình ảnh bìa &amp; nội dung sách/);
});
