const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const { REFUND_POLICY, validateRefundTransition } = require("../backend/refund-policy");

const root = path.join(__dirname, "..");

test("refund policy transition rules block unpaid refunds and terminal state reversals", () => {
  // Unpaid transfer order cannot be refunded
  assert.equal(
    validateRefundTransition(
      { status: "received", paymentMethod: "transfer", paymentStatus: "pending" },
      "cancelled",
      "refunded",
    ).status,
    400,
  );
  // Undelivered COD order cannot be refunded
  assert.equal(
    validateRefundTransition(
      { status: "processing", paymentMethod: "cod", paymentStatus: "cod_pending" },
      "cancelled",
      "refunded",
    ).status,
    400,
  );
  // Paid transfer order can be refunded
  assert.equal(
    validateRefundTransition(
      { status: "cancelled", paymentMethod: "transfer", paymentStatus: "paid" },
      "cancelled",
      "refunded",
    ),
    null,
  );
  // Completed paid order can be refunded (within 7-day return window)
  assert.equal(
    validateRefundTransition(
      { status: "completed", paymentMethod: "transfer", paymentStatus: "paid" },
      "completed",
      "refunded",
    ),
    null,
  );
  // Delivered COD order can be refunded
  assert.equal(
    validateRefundTransition(
      { status: "completed", paymentMethod: "cod", paymentStatus: "cod_pending" },
      "completed",
      "refunded",
    ),
    null,
  );
  // Refunded order cannot transition back to paid or pending
  assert.equal(
    validateRefundTransition(
      { status: "cancelled", paymentMethod: "transfer", paymentStatus: "refunded" },
      "cancelled",
      "paid",
    ).status,
    409,
  );
});

test("refund policy is publicly disclosed before checkout and synchronized across legal pages", () => {
  const refundHtml = fs.readFileSync(path.join(root, "refund.html"), "utf8");
  assert.match(refundHtml, /Chính sách đổi trả &amp; hoàn tiền/);
  assert.match(refundHtml, /7 ngày/);
  assert.match(refundHtml, /3–5 ngày làm việc/);
  assert.match(refundHtml, /id="refundWorkflow"/);
  assert.match(refundHtml, /refunded/);

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /id="checkoutPolicyNotice"[\s\S]*href="refund\.html"/);
  assert.ok(
    indexHtml.indexOf('id="checkoutPolicyNotice"') <
      indexHtml.indexOf('Xác nhận đặt hàng'),
    "Refund policy notice must appear before the checkout submit button",
  );
  assert.match(indexHtml, /<footer[\s\S]*href="refund\.html"/);

  const termsHtml = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  assert.match(termsHtml, /href="refund\.html"/);
  assert.match(termsHtml, /href="privacy\.html"/);
});

test("public refund policy API and admin order refund enforcement work end-to-end", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-refund-policy-test-"),
  );
  const usersPath = path.join(temporaryDirectory, "users.json");
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const auditLogPath = path.join(temporaryDirectory, "audit.jsonl");
  const db = new Database({ usersPath, auditLogPath });
  const server = createServer({
    ordersPath,
    usersPath,
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
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

  // Public policy endpoint
  const policyRes = await fetch(`${baseUrl}/api/policies/refund`);
  assert.equal(policyRes.status, 200);
  const policyBody = await policyRes.json();
  assert.equal(policyBody.policy.version, REFUND_POLICY.version);
  assert.equal(policyBody.policy.returnWindowDays, 7);
  assert.ok(policyBody.policy.eligibleCases.length >= 4);
  assert.ok(policyBody.policy.workflowSteps.length >= 5);

  // Set up admin and create a transfer order
  await db.init();
  const admin = await db.createUser({
    name: "Refund Admin",
    email: "refund-admin@example.com",
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

  const books = await (await fetch(`${baseUrl}/api/books?limit=1`)).json();
  const book = (Array.isArray(books) ? books : (books.items || books.data))[0];
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn C",
      phone: "0903334445",
      address: "10 Đồng Khởi, Quận 1, TP.HCM",
      paymentMethod: "transfer",
      accessCode: "a".repeat(64),
      items: [{ title: book.title, quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const { orderId } = await orderRes.json();

  // Cannot refund unpaid order
  const unpaidRefundRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ paymentStatus: "refunded" }),
  });
  assert.equal(unpaidRefundRes.status, 400);

  // Mark paid, then cancel and refund
  assert.equal(
    (await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ paymentStatus: "paid" }),
    })).status,
    200,
  );
  const refundRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "cancelled", paymentStatus: "refunded" }),
  });
  assert.equal(refundRes.status, 200);
  const refundedOrder = await refundRes.json();
  assert.equal(refundedOrder.paymentStatus, "refunded");

  // Cannot revert refunded order back to paid
  const revertRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ paymentStatus: "paid" }),
  });
  assert.equal(revertRes.status, 409);
});
