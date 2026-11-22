const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  FREE_SHIPPING_THRESHOLD_VND,
  SHIPPING_POLICY,
  estimateShipping,
} = require("../backend/shipping-policy");

const root = path.join(__dirname, "..");

test("estimateShipping calculates fees, free shipping threshold, and ETAs by zone", () => {
  const inner = estimateShipping({ zone: "inner_city", subtotal: 150_000 });
  assert.equal(inner.fee, 20_000);
  assert.equal(inner.freeShippingApplied, false);
  assert.deepEqual(inner.estimatedBusinessDays, { min: 1, max: 2 });

  const innerFree = estimateShipping({ zone: "inner_city", subtotal: FREE_SHIPPING_THRESHOLD_VND });
  assert.equal(innerFree.fee, 0);
  assert.equal(innerFree.freeShippingApplied, true);

  const nationwide = estimateShipping({ zone: "nationwide", subtotal: 100_000 });
  assert.equal(nationwide.fee, 30_000);
  assert.deepEqual(nationwide.estimatedBusinessDays, { min: 2, max: 5 });

  const remote = estimateShipping({ zone: "remote", subtotal: 500_000 });
  assert.equal(remote.fee, 45_000);
  assert.equal(remote.freeShippingApplied, false);

  assert.throws(() => estimateShipping({ zone: "mars", subtotal: 100_000 }), RangeError);
  assert.throws(() => estimateShipping({ zone: "inner_city", subtotal: -1 }), RangeError);
});

test("shipping policy is publicly disclosed before checkout and synchronized across storefront pages", () => {
  const shippingHtml = fs.readFileSync(path.join(root, "shipping.html"), "utf8");
  assert.match(shippingHtml, /Chính sách vận chuyển/);
  assert.match(shippingHtml, /id="shippingAreas"/);
  assert.match(shippingHtml, /id="shippingTracking"/);
  assert.match(shippingHtml, /id="shippingExceptions"/);
  assert.match(shippingHtml, /300\.000 đ/);
  assert.match(shippingHtml, /3 lần/);
  assert.match(shippingHtml, /href="returns\.html"/);
  assert.match(shippingHtml, /href="refund\.html"/);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /id="checkoutPolicyNotice"[\s\S]*href="shipping\.html"/);
  assert.match(indexHtml, /<footer[\s\S]*href="shipping\.html"/);

  for (const page of ["book.html", "returns.html", "refund.html", "terms.html"]) {
    const content = fs.readFileSync(path.join(root, page), "utf8");
    assert.match(content, /href="shipping\.html"/, `${page} must link to shipping.html`);
  }
});

test("public shipping policy API returns service areas, tracking rules, and exception handling", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-shipping-policy-test-"),
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

  const res = await fetch(`${baseUrl}/api/policies/shipping`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.policy.version, SHIPPING_POLICY.version);
  assert.equal(body.policy.freeShippingThresholdVnd, 300_000);
  assert.equal(body.policy.serviceAreas.length, 3);
  assert.ok(body.policy.exceptionHandling.failedDelivery);
  assert.ok(body.policy.exceptionHandling.delayedDelivery);
  assert.ok(body.policy.exceptionHandling.wrongAddress);
});
