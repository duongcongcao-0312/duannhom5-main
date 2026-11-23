"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { CONSUMER_TAX_POLICY } = require("../backend/consumer-tax-policy");

const root = path.join(__dirname, "..");

test("consumer protection, tax, and invoice policy page and compliance doc cover all required obligations and disclosures", () => {
  const html = fs.readFileSync(path.join(root, "consumer-tax.html"), "utf8");
  assert.match(html, /Bảo vệ người tiêu dùng, Thuế &amp; Hóa đơn/);
  for (const sectionId of [
    "consumerPricingTerms",
    "consumerSupportRefunds",
    "taxInvoiceObligations",
    "accountingLegalWorkflow",
  ]) {
    assert.match(html, new RegExp(`id="${sectionId}"`), `consumer-tax.html must include #${sectionId}`);
  }
  assert.match(html, /không phải ý kiến tư vấn pháp lý/i);
  assert.match(html, /href="terms\.html"/);
  assert.match(html, /href="shipping\.html"/);
  assert.match(html, /href="returns\.html"/);
  assert.match(html, /href="refund\.html"/);
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /2 ngày làm việc/);
  assert.match(html, /7 ngày/);
  assert.match(html, /3–5 ngày làm việc/);
  assert.match(html, /hóa đơn điện tử/i);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /<footer[\s\S]*href="consumer-tax\.html"/);

  const termsHtml = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  assert.match(termsHtml, /href="consumer-tax\.html"/);

  const doc = fs.readFileSync(
    path.join(root, "docs", "consumer-tax-invoice-review.md"),
    "utf8",
  );
  assert.match(doc, /không phải ý kiến tư vấn pháp lý/i);
  assert.match(doc, /Minh bạch giá bán/);
  assert.match(doc, /hóa đơn điện tử/i);
  assert.match(doc, /Quy trình phối hợp kế toán/);
  assert.match(doc, /Lưu trữ hồ sơ/);
});

test("public consumer-tax policy API and HTML page are accessible without authentication", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-consumer-tax-test-"),
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

  for (const endpoint of ["/api/policies/consumer-tax", "/api/v1/policies/consumer-tax"]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200, `${endpoint} must return 200`);
    const body = await res.json();
    assert.equal(body.policy.version, CONSUMER_TAX_POLICY.version);
    assert.equal(body.policy.policyUrl, "/consumer-tax.html");
    assert.equal(body.policy.sections.length, 4);
    assert.equal(body.policy.complaintResponseBusinessDays, 2);
    assert.equal(body.policy.returnWindowDays, 7);
    assert.ok(body.policy.invoiceRequestFields.includes("taxCode"));
    assert.deepEqual(body.policy.linkedPolicies, {
      terms: "/terms.html",
      shipping: "/shipping.html",
      returns: "/returns.html",
      refund: "/refund.html",
      privacy: "/privacy.html",
    });
  }

  const pageRes = await fetch(`${baseUrl}/consumer-tax.html`);
  assert.equal(pageRes.status, 200);
  assert.match(await pageRes.text(), /Bảo vệ người tiêu dùng, Thuế &amp; Hóa đơn/);
});
