"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function startServer(directory) {
  const ordersPath = path.join(directory, "orders.jsonl");
  const server = createServer({
    ordersPath,
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    ordersPath,
  };
}

function makeOrderPayload(overrides = {}) {
  return {
    customerName: "Nguyen Van Idempotent",
    address: "123 Duong Sach, Quan 1",
    phone: "0901234567",
    paymentMethod: "cod",
    accessCode: "a1".repeat(32),
    items: [{ title: "Nhà giả kim", quantity: 1 }],
    ...overrides,
  };
}

test("order creation deduplicates sequential retries, concurrent requests, and replays across server restarts", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-idemp-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const first = await startServer(directory);
  const idempotencyKey = "checkout-order-key-2026-0001";
  const payload = makeOrderPayload();

  // 1. Invalid Idempotency-Key rejected with 400
  const badKeyRes = await fetch(`${first.baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "bad!",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(badKeyRes.status, 400);

  // 2. Concurrent burst (5 simultaneous identical requests with same Idempotency-Key)
  const concurrentResponses = await Promise.all(
    Array.from({ length: 5 }, () => fetch(`${first.baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    })),
  );
  const statuses = concurrentResponses.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 200, 200, 200, 201]);

  const bodies = await Promise.all(concurrentResponses.map((r) => r.json()));
  const orderIds = new Set(bodies.map((b) => b.orderId));
  assert.equal(orderIds.size, 1, "all concurrent idempotent requests must return the same orderId");
  const createdOrderId = bodies[0].orderId;

  // Replayed responses carry Idempotency-Key & Idempotency-Replayed: true
  const replayedCount = concurrentResponses.filter(
    (r) => r.status === 200 && r.headers.get("idempotency-replayed") === "true",
  ).length;
  assert.equal(replayedCount, 4);

  // 3. Same Idempotency-Key with DIFFERENT payload returns 409 Conflict
  const conflictRes = await fetch(`${first.baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(makeOrderPayload({ items: [{ title: "Nhà giả kim", quantity: 2 }] })),
  });
  assert.equal(conflictRes.status, 409);

  // 4. Restart server to prove idempotency state is durable on disk (not just in-memory)
  await new Promise((resolve) => first.server.close(resolve));
  const restarted = await startServer(directory);
  t.after(() => new Promise((resolve) => restarted.server.close(resolve)));

  const replayAfterRestart = await fetch(`${restarted.baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(replayAfterRestart.status, 200);
  assert.equal(replayAfterRestart.headers.get("idempotency-replayed"), "true");
  assert.equal(replayAfterRestart.headers.get("idempotency-key"), idempotencyKey);
  const replayBody = await replayAfterRestart.json();
  assert.equal(replayBody.orderId, createdOrderId);

  // Exactly 1 order persisted in orders.jsonl
  const rawOrders = (await fs.readFile(restarted.ordersPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(rawOrders.length, 1);
});
