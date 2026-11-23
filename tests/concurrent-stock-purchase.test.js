"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");
const { PostgresDatabase } = require("../backend/postgres-db");
const { createServer } = require("../server");

async function withServer(t, { stock = 1, title = "Cuốn sách giới hạn" } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-stock-race-"));
  const ordersPath = path.join(directory, "orders.jsonl");
  const db = new Database({
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    ordersPath,
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  await db.init();
  await db.addCustomBook({
    title,
    author: "Tác giả Giới Hạn",
    category: "van-hoc",
    price: 120000,
    stock,
    cover: "",
    description: "Bản giới hạn kiểm thử đồng thời",
  });
  const server = createServer({
    database: db,
    ordersPath,
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    orderRequestLimit: 50,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    ordersPath,
    title,
  };
}

function makeBuyerPayload(title, quantity, index) {
  return {
    customerName: `Buyer ${index}`,
    address: `Address ${index}, District 1`,
    phone: `09012345${String(index).padStart(2, "0")}`,
    paymentMethod: "cod",
    accessCode: String(index + 10).padStart(2, "0").repeat(32),
    items: [{ title, quantity }],
  };
}

test("concurrent buyers competing for the last single copy (stock=1) never oversell", async (t) => {
  const { baseUrl, ordersPath, title: targetTitle } = await withServer(t, { stock: 1 });

  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) => fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `last-copy-buyer-${i + 1}-0001`,
      },
      body: JSON.stringify(makeBuyerPayload(targetTitle, 1, i + 1)),
    })),
  );

  const succeeded = responses.filter((r) => r.status === 201);
  const rejected = responses.filter((r) => r.status === 400);
  assert.equal(succeeded.length, 1, "exactly 1 buyer must win the last copy");
  assert.equal(rejected.length, 9, "all other 9 concurrent buyers must be rejected with 400");

  const savedLines = (await fs.readFile(ordersPath, "utf8")).trim().split("\n").filter(Boolean);
  assert.equal(savedLines.length, 1);
  const totalSold = savedLines
    .map((line) => JSON.parse(line))
    .reduce((sum, order) => sum + order.items.reduce((s, it) => s + it.quantity, 0), 0);
  assert.equal(totalSold, 1);
});

test("concurrent buyers under low stock (stock=3) reserve exact available inventory without overselling", async (t) => {
  const { baseUrl, ordersPath, title: targetTitle } = await withServer(t, { stock: 3 });

  // 6 concurrent buyers each requesting 2 copies when stock is 3 -> exactly 1 succeeds (2 copies)
  const batch1 = await Promise.all(
    Array.from({ length: 6 }, (_, i) => fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `low-stock-2x-${i + 1}-0001`,
      },
      body: JSON.stringify(makeBuyerPayload(targetTitle, 2, i + 1)),
    })),
  );
  assert.equal(batch1.filter((r) => r.status === 201).length, 1);
  assert.equal(batch1.filter((r) => r.status === 400).length, 5);

  // 3 concurrent buyers each requesting 1 copy for the remaining 1 copy -> exactly 1 succeeds
  const batch2 = await Promise.all(
    Array.from({ length: 3 }, (_, i) => fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `low-stock-1x-${i + 1}-0001`,
      },
      body: JSON.stringify(makeBuyerPayload(targetTitle, 1, i + 20)),
    })),
  );
  assert.equal(batch2.filter((r) => r.status === 201).length, 1);
  assert.equal(batch2.filter((r) => r.status === 400).length, 2);

  const savedOrders = (await fs.readFile(ordersPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const totalSold = savedOrders.reduce(
    (sum, order) => sum + order.items.reduce((s, it) => s + it.quantity, 0),
    0,
  );
  assert.equal(totalSold, 3, "total sold must never exceed stock=3");
});

test("PostgresDatabase locks book_inventory in deterministic sorted order and rolls back on oversell", async () => {
  const lockedTitles = [];
  let rolledBack = false;
  const inventoryState = new Map([
    ["Book Alpha", { stock: 5, reserved: 0 }],
    ["Book Zeta", { stock: 1, reserved: 1 }], // out of stock!
  ]);

  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const text = String(sql);
          if (text === "ROLLBACK") {
            rolledBack = true;
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("INSERT INTO order_idempotency")) {
            return { rows: [{ idempotency_key: params[0] }], rowCount: 1 };
          }
          if (text.includes("SET reserved = reserved + $2") && text.includes("reserved + $2 <= stock")) {
            const [title, qty] = params;
            lockedTitles.push(title);
            const row = inventoryState.get(title);
            if (!row || row.reserved + qty > row.stock) {
              return { rows: [], rowCount: 0 };
            }
            row.reserved += qty;
            return { rows: [{ book_title: title }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };

  const db = new PostgresDatabase({ pool });
  db.initialization = Promise.resolve();

  const order = {
    orderId: "00000000-0000-4000-8000-000000000099",
    idempotencyKey: "pg-oversell-check-0001",
    items: [
      { title: "Book Zeta", quantity: 1, unitPrice: 100000 },
      { title: "Book Alpha", quantity: 1, unitPrice: 100000 },
    ],
  };

  await assert.rejects(
    () => db.addOrderIdempotently(
      order,
      "a".repeat(64),
      [
        { title: "Book Zeta", quantity: 1, stock: 1 },
        { title: "Book Alpha", quantity: 1, stock: 5 },
      ],
    ),
    /vượt quá tồn kho/i,
  );
  assert.deepEqual(lockedTitles, ["Book Alpha", "Book Zeta"], "locks must be acquired in sorted title order");
  assert.equal(rolledBack, true, "transaction must roll back when any item exceeds stock");
});
