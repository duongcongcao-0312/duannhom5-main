const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { CustomerError } = require("../backend/db");

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

  const codOrderId = "22222222-2222-4222-8222-222222222222";
  const codResponse = await send({
    ...event("cod-event", "succeeded", 7),
    orderId: codOrderId,
  });
  assert.equal(codResponse.status, 400);
  assert.equal(database.orders.get(codOrderId).paymentStatus, "cod_pending");

  const cancelledOrderId = "33333333-3333-4333-8333-333333333333";
  const cancelledResponse = await send({
    ...event("cancelled-event", "cancelled", 8),
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
    sepayBankCode: "TCB",
    sepayBankName: "Techcombank",
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
    bankCode: "TCB",
    bankName: "Techcombank",
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
