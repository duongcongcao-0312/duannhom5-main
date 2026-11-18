const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { CustomerError } = require("../backend/db");
const {
  bindPaymentQrFallback,
  buildPaymentQrUrl,
  showPaymentQrWaiting,
} = require("../assets/vietqr");

const webhookSecret = "test-payment-webhook-secret-with-32-bytes-min";

function createPaymentDatabase() {
  const orders = new Map([
    ["11111111-1111-4111-8111-111111111111", {
      orderId: "11111111-1111-4111-8111-111111111111",
      status: "received",
      paymentMethod: "transfer",
      paymentStatus: "pending",
      subtotal: 10000,
      discount: 0,
      total: 10000,
      items: [],
    }],
    ["22222222-2222-4222-8222-222222222222", {
      orderId: "22222222-2222-4222-8222-222222222222",
      status: "received",
      paymentMethod: "cod",
      paymentStatus: "cod_pending",
      subtotal: 10000,
      discount: 0,
      total: 10000,
      items: [],
    }],
    ["33333333-3333-4333-8333-333333333333", {
      orderId: "33333333-3333-4333-8333-333333333333",
      status: "received",
      paymentMethod: "transfer",
      paymentStatus: "pending",
      subtotal: 10000,
      discount: 0,
      total: 10000,
      items: [],
    }],
  ]);
  const events = new Map();
  let queue = Promise.resolve();

  return {
    events,
    orders,
    async getCustomBooks() {
      return [];
    },
    async applyPaymentWebhookEvent(event) {
      const operation = queue.then(() => {
        const existingEvent = events.get(event.eventId);
        if (existingEvent) {
          return {
            duplicate: existingEvent === event.eventHash,
            conflict: existingEvent !== event.eventHash,
          };
        }
        const order = orders.get(event.orderId);
        if (!order) {
          throw new CustomerError(404, "Không tìm thấy đơn hàng.");
        }
        if (order.paymentMethod !== "transfer") {
          throw new CustomerError(400, "Đơn hàng này không sử dụng chuyển khoản.");
        }
        if (order.total !== event.amount) {
          throw new CustomerError(400, "Số tiền thanh toán không khớp với đơn hàng.");
        }
        events.set(event.eventId, event.eventHash);
        const eventTime = Date.parse(event.occurredAt);
        const previousEventTime = Date.parse(order.paymentEventAt || "");
        if (Number.isFinite(previousEventTime) && eventTime <= previousEventTime) {
          return { order, duplicate: false, stale: true };
        }
        const terminal = ["paid", "failed", "cancelled", "refunded"];
        const canChangeStatus = order.paymentStatus !== "paid" &&
          !(order.paymentStatus === "refunded" && event.paymentStatus !== "refunded") &&
          !(terminal.includes(order.paymentStatus) && event.paymentStatus === "pending") &&
          !(order.status === "cancelled" && event.paymentStatus === "paid");
        if (canChangeStatus) order.paymentStatus = event.paymentStatus;
        order.paymentEventAt = new Date(eventTime).toISOString();
        return { order, duplicate: false, stale: false };
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

function signPayload(payload) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    signature: `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`,
  };
}

test("payment webhook authenticates, applies payment states once, and ignores stale events", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-payment-webhook-"),
  );
  const database = createPaymentDatabase();
  const server = createServer({
    database,
    paymentWebhookSecret: webhookSecret,
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/api/payments/webhook`;
  const orderId = "11111111-1111-4111-8111-111111111111";
  const event = (id, status, seconds, amount = 10000) => ({
    id,
    orderId,
    status,
    amount,
    currency: "VND",
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
  });
  const send = async (payload, signatureOverride) => {
    const signed = signPayload(payload);
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookNest-Signature": signatureOverride || signed.signature,
      },
      body: signed.rawBody,
    });
  };

  const forgedEvent = event("forged", "succeeded", 1);
  const forgedResponse = await send(forgedEvent, `sha256=${"0".repeat(64)}`);
  assert.equal(forgedResponse.status, 401);
  assert.equal(database.orders.get(orderId).paymentStatus, "pending");

  const pendingEvent = event("event-pending", "pending", 1);
  const pendingResponse = await send(pendingEvent);
  assert.equal(pendingResponse.status, 200);
  assert.equal((await pendingResponse.json()).order.paymentStatus, "pending");

  const failedEvent = event("event-failed", "failed", 2);
  const failedResponse = await send(failedEvent);
  assert.equal(failedResponse.status, 200);
  assert.equal((await failedResponse.json()).order.paymentStatus, "failed");

  const retrySuccessEvent = event("event-success", "succeeded", 3);
  const successResponse = await send(retrySuccessEvent);
  assert.equal(successResponse.status, 200);
  assert.equal((await successResponse.json()).order.paymentStatus, "paid");

  const duplicateResponse = await send(retrySuccessEvent);
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).duplicate, true);
  assert.equal(database.orders.get(orderId).paymentStatus, "paid");

  const concurrentRetry = event("event-concurrent-retry", "failed", 4);
  const concurrentResponses = await Promise.all([
    send(concurrentRetry),
    send(concurrentRetry),
  ]);
  assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
  const concurrentBodies = await Promise.all(
    concurrentResponses.map((response) => response.json()),
  );
  assert.equal(concurrentBodies.filter((body) => body.duplicate).length, 1);
  assert.equal(database.orders.get(orderId).paymentStatus, "paid");

  const staleResponse = await send(event("event-stale", "failed", 2));
  assert.equal(staleResponse.status, 200);
  assert.equal((await staleResponse.json()).stale, true);
  assert.equal(database.orders.get(orderId).paymentStatus, "paid");

  const reusedEventIdResponse = await send(event("event-success", "failed", 5));
  assert.equal(reusedEventIdResponse.status, 409);

  const wrongAmountResponse = await send(event("wrong-amount", "succeeded", 6, 1));
  assert.equal(wrongAmountResponse.status, 400);
  assert.equal(database.events.has("wrong-amount"), false);

  const unknownOrderResponse = await send({
    ...event("unknown-order", "succeeded", 7),
    orderId: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(unknownOrderResponse.status, 404);
  assert.equal(database.events.has("unknown-order"), false);

  const codOrderId = "22222222-2222-4222-8222-222222222222";
  const codResponse = await send({
    ...event("cod-event", "succeeded", 8),
    orderId: codOrderId,
  });
  assert.equal(codResponse.status, 400);
  assert.equal(database.orders.get(codOrderId).paymentStatus, "cod_pending");

  const cancelledOrderId = "33333333-3333-4333-8333-333333333333";
  const cancelledResponse = await send({
    ...event("cancelled-event", "cancelled", 9),
    orderId: cancelledOrderId,
  });
  assert.equal(cancelledResponse.status, 200);
  assert.equal(
    (await cancelledResponse.json()).order.paymentStatus,
    "cancelled",
  );
});

test("SePay config, webhook, and order status endpoints work together", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-sepay-webhook-"),
  );
  const order = {
    orderId: "44444444-4444-4444-8444-444444444444",
    paymentCode: "BN1234567890AB",
    paymentMethod: "transfer",
    paymentStatus: "pending",
    status: "received",
    total: 10000,
  };
  let appliedEvent;
  const database = {
    async getCustomBooks() {
      return [];
    },
    async getAllOrders() {
      return [order];
    },
    async findOrderById(orderId) {
      return orderId === order.orderId ? order : null;
    },
    async applyPaymentWebhookEvent(event) {
      appliedEvent = event;
      return { duplicate: false };
    },
  };
  const server = createServer({
    database,
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    sepayApiKey: "test-sepay-api-key-123456",
    sepayBankCode: "970415",
    sepayBankName: "VietinBank",
    sepayAccountNumber: "88803122007888",
    sepayAccountName: "BookNest",
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
  const configResponse = await fetch(`${baseUrl}/api/payments/config`);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(await configResponse.json(), {
    bankCode: "970415",
    bankName: "VietinBank",
    accountNumber: "88803122007888",
    accountName: "BookNest",
  });

  const statusResponse = await fetch(`${baseUrl}/api/orders/${order.orderId}/status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    paymentStatus: "pending",
    orderStatus: "received",
  });

  const payload = {
    id: 12345,
    transferAmount: 10000,
    transferType: "in",
    accountNumber: "88803122007888",
    content: `Thanh toan ${order.paymentCode}`,
    transactionDate: "2026-01-01 10:00:00",
  };
  const amountMismatchResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: {
      Authorization: "Apikey test-sepay-api-key-123456",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, transferAmount: 10001 }),
  });
  assert.deepEqual(await amountMismatchResponse.json(), {
    success: true,
    ignored: true,
    reason: "payment_details_mismatch",
  });
  assert.equal(appliedEvent, undefined);

  const unknownPaymentCodeResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: {
      Authorization: "Apikey test-sepay-api-key-123456",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, content: "Thanh toan BNFFFFFFFFFFFF" }),
  });
  assert.deepEqual(await unknownPaymentCodeResponse.json(), {
    success: true,
    ignored: true,
    reason: "order_not_found",
  });
  assert.equal(appliedEvent, undefined);

  const webhookResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: {
      Authorization: "Apikey test-sepay-api-key-123456",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(webhookResponse.status, 200);
  assert.deepEqual(await webhookResponse.json(), { success: true, duplicate: false });
  assert.equal(appliedEvent.eventId, "sepay:12345");
  assert.equal(appliedEvent.orderId, order.orderId);
  assert.equal(appliedEvent.paymentStatus, "paid");
  assert.equal(appliedEvent.amount, 10000);

  const unauthorizedResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(unauthorizedResponse.status, 401);
});

test("VietQR builder encodes only the payment code and rejects invalid payment data", () => {
  const config = {
    bankCode: "970422",
    accountNumber: "123456789",
    accountName: "BookNest Test",
  };
  const order = {
    orderId: "order-test",
    paymentMethod: "transfer",
    paymentCode: "BN1234567890AB",
    total: 245000,
  };

  const qrUrl = new URL(buildPaymentQrUrl(config, order));
  assert.equal(qrUrl.hostname, "img.vietqr.io");
  assert.equal(qrUrl.searchParams.get("amount"), String(order.total));
  assert.equal(qrUrl.searchParams.get("addInfo"), order.paymentCode);
  assert.equal(qrUrl.searchParams.get("accountName"), config.accountName);
  assert.doesNotMatch(qrUrl.searchParams.get("addInfo"), /BOOKNEST/i);
	assert.equal(qrUrl.pathname, `/image/${config.bankCode}-${config.accountNumber}-compact2.png`);
	const fallbackUrl = new URL(buildPaymentQrUrl(config, order, "svg"));
	assert.equal(fallbackUrl.pathname, `/image/${config.bankCode}-${config.accountNumber}-compact2.svg`);
	assert.equal(fallbackUrl.searchParams.get("amount"), String(order.total));
	assert.equal(fallbackUrl.searchParams.get("addInfo"), order.paymentCode);
  assert.equal(fallbackUrl.searchParams.get("accountName"), config.accountName);

  assert.throws(() => buildPaymentQrUrl(config, null), /Đơn hàng chuyển khoản/);
  assert.throws(() => buildPaymentQrUrl(config, { ...order, paymentMethod: "cod" }), /Đơn hàng chuyển khoản/);
  assert.throws(() => buildPaymentQrUrl({ ...config, bankCode: "TCB" }, order), /BIN gồm 6 chữ số/);
  assert.throws(() => buildPaymentQrUrl({ ...config, accountNumber: "bad-account" }, order), /Số tài khoản/);
});

test("VietQR stays hidden while waiting and CSS honors the hidden attribute", async () => {
  const image = {
    hidden: false,
    style: { visibility: "hidden" },
    removed: false,
    removeAttribute(name) { if (name === "src") this.removed = true; },
  };
  const fallback = { hidden: false };
  const status = { hidden: true, textContent: "" };

  showPaymentQrWaiting(image, fallback, status, "QR chưa có vì đơn chưa được lưu.");
  assert.equal(image.hidden, true);
  assert.equal(image.style.visibility, "");
  assert.equal(image.removed, true);
  assert.equal(fallback.hidden, true);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, "QR chưa có vì đơn chưa được lưu.");

  const css = await fsPromises.readFile(path.join(__dirname, "..", "main.css"), "utf8");
  assert.match(css, /\.qr-payment img\[hidden\]\s*\{\s*display:\s*none\s*;/);
});

test("VietQR image failure retries SVG then shows safe manual transfer details", () => {
  const order = {
    orderId: "order-test",
    paymentMethod: "transfer",
    paymentCode: "BN1234567890AB",
    total: 245000,
  };
  const fields = {
    "[data-payment-qr-amount]": { textContent: "" },
    "[data-payment-qr-code]": { textContent: "" },
  };
  const fallback = {
    hidden: true,
    querySelector(selector) { return fields[selector]; },
  };
  const image = {
    hidden: true,
    src: "",
    style: { visibility: "" },
    removed: false,
    removeAttribute(name) { if (name === "src") this.removed = true; },
  };
  const status = { hidden: false, textContent: "Đang tải QR" };

  bindPaymentQrFallback(image, fallback, status, order, "https://img.vietqr.io/fallback.svg");
  image.onerror();
  assert.equal(image.src, "https://img.vietqr.io/fallback.svg");
  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, true);

  image.onerror();
  assert.equal(image.hidden, true);
  assert.equal(image.removed, true);
  assert.equal(fallback.hidden, false);
  assert.equal(status.hidden, true);
  assert.equal(fields["[data-payment-qr-amount]"].textContent, "245.000");
  assert.equal(fields["[data-payment-qr-code]"].textContent, order.paymentCode);
});

test("a created transfer order produces a QR whose payment code matches the SePay webhook", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-vietqr-order-flow-"),
  );
  const orders = [];
  let appliedEvent;
  const database = {
    async getCustomBooks() { return []; },
    async getCatalogBookOverrides() { return []; },
    async getAllOrders() { return orders; },
    async addOrderIdempotently(order, _hash, _inventory, validateStock) {
      validateStock(orders);
      orders.push(order);
      return { order, replayed: false };
    },
    async applyPaymentWebhookEvent(event) {
      appliedEvent = event;
      return { duplicate: false };
    },
  };
  const config = {
    bankCode: "970422",
    bankName: "MB Bank",
    accountNumber: "123456789",
    accountName: "BookNest Test",
  };
  const server = createServer({
    database,
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    sepayApiKey: "test-sepay-api-key-123456",
    sepayBankCode: config.bankCode,
    sepayBankName: config.bankName,
    sepayAccountNumber: config.accountNumber,
    sepayAccountName: config.accountName,
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
  const orderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "vietqr-order-flow-001",
    },
    body: JSON.stringify({
      customerName: "Local Test Customer",
      address: "12 Local Test Street, District 1",
      phone: "0901234567",
      paymentMethod: "transfer",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderResponse.status, 201);
  const order = await orderResponse.json();
  assert.equal(order.paymentMethod, "transfer");
  assert.match(order.paymentCode, /^BN[A-F0-9]{12}$/);

  const qrUrl = new URL(buildPaymentQrUrl(config, order));
  assert.equal(qrUrl.searchParams.get("amount"), String(order.total));
  assert.equal(qrUrl.searchParams.get("addInfo"), order.paymentCode);
	assert.equal(qrUrl.pathname, `/image/${config.bankCode}-${config.accountNumber}-compact2.png`);

  const webhookResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: {
      Authorization: "Apikey test-sepay-api-key-123456",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "local-vietqr-payment-1",
      transferAmount: order.total,
      transferType: "in",
      accountNumber: config.accountNumber,
      content: qrUrl.searchParams.get("addInfo"),
    }),
  });
  assert.equal(webhookResponse.status, 200);
  assert.equal(appliedEvent.orderId, order.orderId);
  assert.equal(appliedEvent.amount, order.total);
});

test("payment endpoints reject an invalid BIN and a missing SePay webhook key", async (t) => {
  const database = {
    async getCustomBooks() { return []; },
    async getCatalogBookOverrides() { return []; },
  };
  const server = createServer({
    database,
    sepayApiKey: "",
    sepayBankCode: "TCB",
    sepayBankName: "Test Bank",
    sepayAccountNumber: "123456789",
    sepayAccountName: "BookNest Test",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/payments/config`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /chưa được cấu hình/i);

  const webhookResponse = await fetch(`${baseUrl}/api/payments/sepay-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(webhookResponse.status, 503);
  assert.match((await webhookResponse.json()).error, /chưa được cấu hình đầy đủ/i);
});
