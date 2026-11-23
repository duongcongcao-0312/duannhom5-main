"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { ECOMMERCE_COMPLIANCE } = require("../backend/ecommerce-compliance");

const root = path.join(__dirname, "..");

test("Vietnam e-commerce compliance page and dossier document model, obligations, verification owners, and disclosures", () => {
  const html = fs.readFileSync(path.join(root, "ecommerce-compliance.html"), "utf8");
  assert.match(html, /Thông tin tuân thủ website thương mại điện tử/);
  for (const sectionId of [
    "ecommerceModel",
    "ecommerceObligations",
    "ecommerceVerificationOwners",
    "ecommerceDisclosures",
  ]) {
    assert.match(html, new RegExp(`id="${sectionId}"`), `ecommerce-compliance.html must include #${sectionId}`);
  }
  assert.match(html, /online\.gov\.vn/);
  assert.match(html, /không thay thế/i);
  for (const href of [
    "terms.html",
    "shipping.html",
    "returns.html",
    "refund.html",
    "privacy.html",
    "consumer-tax.html",
  ]) {
    assert.match(html, new RegExp(`href="${href.replace(".", "\\.")}"`));
  }

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /<footer[\s\S]*href="ecommerce-compliance\.html"/);

  const doc = fs.readFileSync(
    path.join(root, "docs", "ecommerce-legal-compliance-vn.md"),
    "utf8",
  );
  assert.match(doc, /Website thương mại điện tử bán hàng/);
  assert.match(doc, /online\.gov\.vn/);
  assert.match(doc, /pending_prelaunch_signoff/);
  assert.match(doc, /không thay thế/i);
});

test("public ecommerce-compliance API and HTML page are accessible without authentication", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-ecommerce-compliance-test-"),
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
    "/api/policies/ecommerce-compliance",
    "/api/v1/policies/ecommerce-compliance",
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200, `${endpoint} must return 200`);
    const body = await res.json();
    assert.equal(body.policy.version, ECOMMERCE_COMPLIANCE.version);
    assert.equal(body.policy.jurisdiction, "VN");
    assert.equal(body.policy.websiteModel, "ecommerce_sales_website");
    assert.equal(body.policy.sections.length, 4);
    assert.equal(body.policy.verificationOwners.length, 4);
    assert.deepEqual(body.policy.linkedPolicies, {
      terms: "/terms.html",
      shipping: "/shipping.html",
      returns: "/returns.html",
      refund: "/refund.html",
      privacy: "/privacy.html",
      consumerTax: "/consumer-tax.html",
    });
  }

  const pageRes = await fetch(`${baseUrl}/ecommerce-compliance.html`);
  assert.equal(pageRes.status, 200);
  assert.match(await pageRes.text(), /Thông tin tuân thủ website thương mại điện tử/);
});
