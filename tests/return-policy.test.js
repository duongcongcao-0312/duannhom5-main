const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { RETURN_POLICY, evaluateReturnEligibility } = require("../backend/return-policy");

const root = path.join(__dirname, "..");

test("evaluateReturnEligibility enforces 7-day window, evidence, condition, and shipping responsibility", () => {
  const defective = evaluateReturnEligibility({
    reason: "defective_or_damaged",
    daysSinceDelivery: 3,
    hasEvidence: true,
    itemIntact: false,
  });
  assert.equal(defective.eligible, true);
  assert.equal(defective.shippingPaidBy, "booknest");

  const changeOfMindIntact = evaluateReturnEligibility({
    reason: "change_of_mind",
    daysSinceDelivery: 7,
    hasEvidence: true,
    itemIntact: true,
  });
  assert.equal(changeOfMindIntact.eligible, true);
  assert.equal(changeOfMindIntact.shippingPaidBy, "customer");

  const changeOfMindUsed = evaluateReturnEligibility({
    reason: "change_of_mind",
    daysSinceDelivery: 2,
    hasEvidence: true,
    itemIntact: false,
  });
  assert.equal(changeOfMindUsed.eligible, false);

  const overdue = evaluateReturnEligibility({
    reason: "defective_or_damaged",
    daysSinceDelivery: 8,
    hasEvidence: true,
  });
  assert.equal(overdue.eligible, false);

  const missingEvidence = evaluateReturnEligibility({
    reason: "wrong_or_missing_item",
    daysSinceDelivery: 1,
    hasEvidence: false,
  });
  assert.equal(missingEvidence.eligible, false);
});

test("return policy is publicly disclosed before purchase and synchronized with refund and legal pages", () => {
  const returnsHtml = fs.readFileSync(path.join(root, "returns.html"), "utf8");
  assert.match(returnsHtml, /Chính sách đổi trả hàng/);
  assert.match(returnsHtml, /7 ngày/);
  assert.match(returnsHtml, /id="returnEvidence"/);
  assert.match(returnsHtml, /id="returnProcess"/);
  assert.match(returnsHtml, /href="refund\.html"/);
  assert.match(returnsHtml, /href="terms\.html"/);
  assert.match(returnsHtml, /href="privacy\.html"/);

  const bookDetailJs = fs.readFileSync(path.join(root, "book-detail.js"), "utf8");
  assert.match(bookDetailJs, /id="productReturnNotice"[\s\S]*href="returns\.html"/);

  const bookHtml = fs.readFileSync(path.join(root, "book.html"), "utf8");
  assert.match(bookHtml, /href="returns\.html"/);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /id="checkoutPolicyNotice"[\s\S]*href="returns\.html"/);
  assert.match(indexHtml, /<footer[\s\S]*href="returns\.html"/);

  const refundHtml = fs.readFileSync(path.join(root, "refund.html"), "utf8");
  assert.match(refundHtml, /href="returns\.html"/);

  const termsHtml = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  assert.match(termsHtml, /href="returns\.html"/);
});

test("public return policy API returns structured return conditions, shipping responsibility, and workflow", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-return-policy-test-"),
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

  const res = await fetch(`${baseUrl}/api/policies/return`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.policy.version, RETURN_POLICY.version);
  assert.equal(body.policy.returnWindowDays, 7);
  assert.equal(body.policy.refundPolicyUrl, "/refund.html");
  assert.ok(body.policy.eligibleCases.length >= 3);
  assert.ok(body.policy.workflowSteps.length >= 5);
});
