const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { TERMS_POLICY } = require("../backend/terms-policy");

const root = path.join(__dirname, "..");

test("terms of service cover required sections, sync with all policies, and are accessible before transactions", () => {
  const termsHtml = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  assert.match(termsHtml, /Điều khoản sử dụng/);
  for (const sectionId of [
    "termsAccount",
    "termsOrdering",
    "termsIpUsage",
    "termsLinkedPolicies",
    "termsChanges",
    "termsComplaints",
  ]) {
    assert.match(termsHtml, new RegExp(`id="${sectionId}"`), `terms.html must include #${sectionId}`);
  }
  assert.match(termsHtml, /href="shipping\.html"/);
  assert.match(termsHtml, /href="returns\.html"/);
  assert.match(termsHtml, /href="refund\.html"/);
  assert.match(termsHtml, /href="privacy\.html"/);
  assert.match(termsHtml, /7 ngày/);
  assert.match(termsHtml, /2 ngày làm việc/);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /id="registerPolicyNotice"[\s\S]*href="terms\.html"/);
  assert.ok(
    indexHtml.indexOf('id="registerPolicyNotice"') <
      indexHtml.indexOf('type="submit">Tạo tài khoản</button>'),
    "Terms notice must appear before account registration submit button",
  );
  assert.match(indexHtml, /id="checkoutPolicyNotice"[\s\S]*href="terms\.html"/);
  assert.ok(
    indexHtml.indexOf('id="checkoutPolicyNotice"') < indexHtml.indexOf("Xác nhận đặt hàng"),
    "Terms notice must appear before checkout submit button",
  );
  assert.match(indexHtml, /<footer[\s\S]*href="terms\.html"/);
});

test("public terms policy API returns structured sections and linked policy URLs", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-terms-policy-test-"),
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

  const res = await fetch(`${baseUrl}/api/policies/terms`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.policy.version, TERMS_POLICY.version);
  assert.equal(body.policy.changeNoticeDays, 7);
  assert.equal(body.policy.sections.length, 6);
  assert.deepEqual(body.policy.linkedPolicies, {
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
    privacy: "/privacy.html",
  });
});
