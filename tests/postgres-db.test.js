const assert = require("node:assert/strict");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");
const { hashOrderRequest } = require("../backend/order-idempotency");

function withAdminConfig(t, email = "admin@example.com", password = "strong-password-123") {
  const originalEmail = process.env.ADMIN_EMAIL;
  const originalPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAIL = email;
  process.env.ADMIN_PASSWORD = password;
  t.after(() => {
    if (originalEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalEmail;
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
  });
}

test("PostgresDatabase rejects a missing DATABASE_URL", () => {
  assert.throws(
    () => new PostgresDatabase({ connectionString: "" }),
    /DATABASE_URL là bắt buộc/,
  );
});

test("PostgresDatabase initializes once and creates the configured admin", async (t) => {
  withAdminConfig(t);
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("SELECT records")) {
        return { rows: [{ records: [] }] };
      }
      return { rows: [] };
    },
    async end() {
      queries.push({ sql: "END" });
    },
  };
  const db = new PostgresDatabase({ pool });

  await db.init();
  await db.init();
  assert.equal(queries.filter((entry) => entry.sql.includes("CREATE TABLE")).length, 3);
  assert.ok(queries.some((entry) => entry.sql.includes("CREATE TABLE IF NOT EXISTS payment_webhook_events")));
  assert.ok(queries.some((entry) => entry.sql.includes("CREATE TABLE IF NOT EXISTS auth_sessions")));
  assert.ok(queries.some((entry) => entry.sql.includes("idx_auth_sessions_user_id")));
  assert.ok(queries.some((entry) => entry.sql.includes("idx_auth_sessions_expires_at")));
  assert.equal(queries.filter((entry) => entry.sql.includes("SELECT records")).length, 1);
  assert.equal(queries.filter((entry) => entry.sql.includes("INSERT INTO")).length, 1);
  await db.close();
  assert.equal(queries.at(-1).sql, "END");
});

test("PostgresDatabase stores only hashed session keys and enforces database expiry", async (t) => {
  withAdminConfig(t);
  const statements = [];
  const expiresAt = Date.now() + 60_000;
  const sessionData = {
    userId: "session-user",
    email: "session@example.com",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt,
  };
  const pool = {
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      if (sql.includes("SELECT session_data")) {
        return {
          rows: [{
            session_data: sessionData,
            expires_at: new Date(expiresAt),
          }],
        };
      }
      if (sql.includes("DELETE FROM auth_sessions WHERE session_hash")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const db = new PostgresDatabase({ pool });
  const sessionHash = "a".repeat(64);
  const persistedSession = { ...sessionData, token: "must-not-be-persisted" };

  await db.saveSessionRecord(sessionHash, persistedSession);
  const insert = statements.find((entry) => entry.sql.includes("INSERT INTO auth_sessions"));
  assert.equal(insert.values[0], sessionHash);
  assert.equal(insert.values[1], sessionData.userId);
  assert.doesNotMatch(insert.values[2], /must-not-be-persisted/);
  assert.equal(insert.values[3], expiresAt);
  assert.deepEqual(await db.getSessionRecord(sessionHash), {
    ...sessionData,
    expiresAt,
  });
  assert.equal(await db.deleteSessionRecord(sessionHash), true);
  const lookup = statements.find((entry) => entry.sql.includes("SELECT session_data"));
  assert.match(lookup.sql, /expires_at > NOW\(\)/);
  assert.equal(lookup.values[0], sessionHash);
});

test("PostgresDatabase applies signed payment events idempotently and rejects out-of-order updates", async (t) => {
  withAdminConfig(t);
  const orderId = "11111111-1111-4111-8111-111111111111";
  let orders = [{
    orderId,
    status: "received",
    paymentMethod: "transfer",
    paymentStatus: "pending",
    total: 25000,
    items: [],
  }];
  const events = new Map();
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("INSERT INTO payment_webhook_events")) {
            if (events.has(values[0])) return { rows: [], rowCount: 0 };
            events.set(values[0], values[1]);
            return { rows: [{ event_id: values[0] }], rowCount: 1 };
          }
          if (sql.includes("SELECT event_hash")) {
            return {
              rows: events.has(values[0])
                ? [{ event_hash: events.get(values[0]) }]
                : [],
              rowCount: events.has(values[0]) ? 1 : 0,
            };
          }
          if (sql.includes("SELECT records FROM booknest_data")) {
            return { rows: [{ records: orders }] };
          }
          if (sql.includes("UPDATE booknest_data SET records")) {
            orders = JSON.parse(values[0]);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const db = new PostgresDatabase({ pool });
  const firstEvent = {
    eventId: "payment-event-1",
    eventHash: "a".repeat(64),
    orderId,
    paymentStatus: "paid",
    amount: 25000,
    occurredAt: "2026-01-01T00:00:02.000Z",
  };

  const applied = await db.applyPaymentWebhookEvent(firstEvent);
  assert.equal(applied.order.paymentStatus, "paid");
  assert.equal(applied.duplicate, false);

  const duplicate = await db.applyPaymentWebhookEvent(firstEvent);
  assert.equal(duplicate.duplicate, true);

  const conflictingReuse = await db.applyPaymentWebhookEvent({
    ...firstEvent,
    eventHash: "b".repeat(64),
  });
  assert.equal(conflictingReuse.conflict, true);

  const stale = await db.applyPaymentWebhookEvent({
    ...firstEvent,
    eventId: "payment-event-old",
    eventHash: "c".repeat(64),
    paymentStatus: "failed",
    occurredAt: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(stale.stale, true);
  assert.equal(orders[0].paymentStatus, "paid");
});

test("initialization failure is propagated and can be retried", async () => {
  let attempts = 0;
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("CREATE TABLE")) {
        attempts += 1;
        if (attempts === 1) throw new Error("connection refused");
      }
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      return { rows: [] };
    },
  };
  const db = new PostgresDatabase({ pool });

  await assert.rejects(db.init(), /connection refused/);
  await assert.rejects(db.init(), /Đặt ADMIN_EMAIL/);
  assert.equal(attempts, 4);
});

test("query timeout and query failure are surfaced without fallback data", async (t) => {
  withAdminConfig(t);
  const timeoutPool = {
    async query(sql, values = []) {
      if (sql.includes("SELECT records")) throw new Error("query timeout");
      return { rows: [] };
    },
  };
  const timeoutDb = new PostgresDatabase({ pool: timeoutPool });
  await assert.rejects(timeoutDb.getUsers(), /query timeout/);

  const failurePool = {
    async query(sql) {
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      if (sql.includes("CREATE TABLE")) return { rows: [] };
      throw new Error("query failed");
    },
  };
  const failureDb = new PostgresDatabase({ pool: failurePool });
  await assert.rejects(failureDb.readCollection("orders"), /query failed/);
  t.after(() => failureDb.close().catch(() => {}));
});

test("transaction rolls back on query failure and always releases the client", async (t) => {
  withAdminConfig(t);
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === "SELECT records FROM booknest_data WHERE collection = $1 FOR UPDATE") {
        return { rows: [{ records: [] }] };
      }
      if (sql.startsWith("UPDATE booknest_data")) throw new Error("write failed");
      return { rows: [] };
    },
    release() {
      calls.push("RELEASE");
    },
  };
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      return { rows: [] };
    },
    async connect() {
      calls.push("CONNECT");
      return client;
    },
  };
  const db = new PostgresDatabase({ pool });
  await assert.rejects(
    db.updateCollection("orders", (orders) => {
      orders.push({ orderId: "test-order" });
    }),
    /write failed/,
  );
  assert.deepEqual(calls, [
    "CONNECT",
    "BEGIN",
    "INSERT INTO booknest_data (collection, records) VALUES ($1, '[]'::jsonb) ON CONFLICT (collection) DO NOTHING",
    "SELECT records FROM booknest_data WHERE collection = $1 FOR UPDATE",
    "UPDATE booknest_data SET records = $2::jsonb, updated_at = NOW() WHERE collection = $1",
    "ROLLBACK",
    "RELEASE",
  ]);
  t.after(() => db.close().catch(() => {}));
});

test("customer transaction rolls back mutations and retry initialization remains possible", async (t) => {
  withAdminConfig(t);
  const records = new Map([["users", []], ["customers", []]]);
  let initialized = false;
  let failInitialization = true;
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("CREATE TABLE")) {
        if (failInitialization) {
          failInitialization = false;
          throw new Error("temporary database outage");
        }
        initialized = true;
      }
      if (sql.includes("SELECT records")) {
        return { rows: [{ records: records.get(values[0] || "users") || [] }] };
      }
      return { rows: [] };
    },
    async connect() {
      const snapshot = JSON.stringify(records.get("customers") || []);
      return {
        async query(sql, values = []) {
          if (sql.includes("INSERT INTO")) {
            if (!records.has(values[0])) records.set(values[0], []);
          } else if (sql.includes("SELECT records")) {
            return { rows: [{ records: records.get(values[0]) || [] }] };
          } else if (sql.includes("UPDATE booknest_data SET records")) {
            records.set(values[0], JSON.parse(values[1]));
          } else if (sql === "ROLLBACK") {
            records.set("customers", JSON.parse(snapshot));
          }
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  await assert.rejects(db.init(), /temporary database outage/);
  await db.init();
  assert.equal(initialized, true);

  await assert.rejects(
    db.updateCollection("customers", (customers) => {
      customers.push({ id: "customer-rollback" });
      throw new Error("customer write failed");
    }),
    /customer write failed/,
  );
  assert.deepEqual(await db.getCustomers(), []);
});

test("order persistence is idempotent by order ID and idempotency key", async (t) => {
  withAdminConfig(t);
  const records = new Map([["orders", []]]);
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("SELECT records")) {
        return { rows: [{ records: records.get(values[0]) || [] }] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql.includes("INSERT INTO")) {
            if (!records.has(values[0])) records.set(values[0], []);
          } else if (sql.includes("SELECT records")) {
            return { rows: [{ records: records.get(values[0]) || [] }] };
          } else if (sql.includes("UPDATE booknest_data SET records")) {
            records.set(values[0], JSON.parse(values[1]));
          }
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  const order = { orderId: "order-idempotent", idempotencyKey: "request-1", total: 10 };
  assert.equal((await db.addOrder(order)).orderId, order.orderId);
  assert.equal((await db.addOrder({ ...order, total: 20 })).total, 10);
  assert.equal((await db.addOrder({
    orderId: "different-id",
    idempotencyKey: "request-1",
    total: 30,
  })).orderId, order.orderId);
  assert.equal((await db.getAllOrders()).length, 1);
});

test("separate PostgreSQL database instances share atomic idempotent order results", async (t) => {
  withAdminConfig(t);
  const idempotencyRecords = new Map();
  const collections = new Map([["users", []], ["orders", []]]);
  const inventoryRecords = new Map();
  let failOrderWrite = false;
  let transactionTail = Promise.resolve();
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT records")) return { rows: [{ records: collections.get("users") }] };
      return { rows: [] };
    },
    async connect() {
      let releaseTransaction;
      let snapshot;
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN") {
            const previous = transactionTail;
            transactionTail = new Promise((resolve) => { releaseTransaction = resolve; });
            await previous;
            snapshot = {
              idempotency: new Map(idempotencyRecords),
              collections: new Map([...collections].map(([key, value]) => [key, structuredClone(value)])),
              inventory: new Map([...inventoryRecords].map(([key, value]) => [key, { ...value }])),
            };
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith("INSERT INTO order_idempotency")) {
            const [key, requestHash, serializedOrder] = values;
            if (idempotencyRecords.has(key)) return { rows: [], rowCount: 0 };
            const order = JSON.parse(serializedOrder);
            idempotencyRecords.set(key, { request_hash: requestHash, order_record: order });
            return { rows: [{ order_record: order }], rowCount: 1 };
          }
          if (sql.includes("SELECT request_hash, order_record")) {
            return { rows: [idempotencyRecords.get(values[0])], rowCount: 1 };
          }
          if (sql.startsWith("UPDATE order_idempotency SET request_hash")) {
            idempotencyRecords.get(values[0]).request_hash = values[1];
          } else if (sql.startsWith("UPDATE order_idempotency")) {
            const record = idempotencyRecords.get(values[0]);
            if (record) record.order_record = JSON.parse(values[1]);
          } else if (sql.startsWith("INSERT INTO book_inventory")) {
            const [title, stock, reserved] = values;
            if (!inventoryRecords.has(title)) inventoryRecords.set(title, { stock, reserved });
          } else if (sql.includes("SET stock = GREATEST($2, reserved)")) {
            const record = inventoryRecords.get(values[0]);
            record.stock = Math.max(values[1], record.reserved);
          } else if (sql.includes("SET reserved = reserved + $2")) {
            const record = inventoryRecords.get(values[0]);
            if (record.reserved + values[1] > record.stock) {
              return { rows: [], rowCount: 0 };
            }
            record.reserved += values[1];
            return { rows: [{ book_title: values[0] }], rowCount: 1 };
          } else if (sql.includes("SET reserved = reserved - $2")) {
            const record = inventoryRecords.get(values[0]);
            if (!record || record.reserved < values[1]) {
              return { rows: [], rowCount: 0 };
            }
            record.reserved -= values[1];
            return { rows: [{ book_title: values[0] }], rowCount: 1 };
          } else if (sql.includes("SET reserved = GREATEST(reserved - $2, 0)")) {
            const record = inventoryRecords.get(values[0]);
            if (record) record.reserved = Math.max(record.reserved - values[1], 0);
          } else if (sql.includes("INSERT INTO booknest_data")) {
            if (!collections.has("orders")) collections.set("orders", []);
          } else if (sql.includes("SELECT records FROM booknest_data")) {
            return { rows: [{ records: collections.get("orders") }], rowCount: 1 };
          } else if (sql.startsWith("UPDATE booknest_data")) {
            if (failOrderWrite) throw new Error("order write failed");
            collections.set("orders", JSON.parse(values[0]));
          } else if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (sql === "ROLLBACK") {
              idempotencyRecords.clear();
              for (const [key, value] of snapshot.idempotency) idempotencyRecords.set(key, value);
              collections.clear();
              for (const [key, value] of snapshot.collections) collections.set(key, value);
              inventoryRecords.clear();
              for (const [key, value] of snapshot.inventory) inventoryRecords.set(key, value);
            }
            releaseTransaction();
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async end() {},
  };
  const firstInstance = new PostgresDatabase({ pool });
  const secondInstance = new PostgresDatabase({ pool });
  t.after(() => Promise.all([firstInstance.close(), secondInstance.close()]));

  const order = {
    orderId: "shared-order",
    idempotencyKey: "shared-request-key",
    userId: "user-1",
    customerName: "Shared User",
    phone: "0901234567",
    address: "123 Shared User Test Address",
    paymentMethod: "cod",
    discountRate: 0,
    couponCode: null,
    subtotal: 25,
    discount: 0,
    total: 25,
    status: "received",
    items: [{ title: "Test Book", quantity: 1 }],
  };
  const requestHash = hashOrderRequest(order);
  const [first, concurrentRetry] = await Promise.all([
    firstInstance.addOrderIdempotently(order, requestHash, [
      { title: "Test Book", quantity: 1, stock: 1 },
    ]),
    secondInstance.addOrderIdempotently(
      { ...order, orderId: "retry-order-id" },
      requestHash,
      [{ title: "Test Book", quantity: 1, stock: 1 }],
    ),
  ]);
  assert.equal(first.conflict, false);
  assert.equal(concurrentRetry.replayed, true);
  assert.equal(concurrentRetry.order.orderId, "shared-order");
  assert.equal(collections.get("orders").length, 1);
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 1, reserved: 1 });

  failOrderWrite = true;
  const rolledBackOrder = {
    ...order,
    orderId: "rolled-back-order",
    idempotencyKey: "rolled-back-request",
    items: [{ title: "Rollback Book", quantity: 1 }],
  };
  await assert.rejects(
    firstInstance.addOrderIdempotently(
      rolledBackOrder,
      hashOrderRequest(rolledBackOrder),
      [{ title: "Rollback Book", quantity: 1, stock: 2 }],
    ),
    /order write failed/,
  );
  failOrderWrite = false;
  assert.equal(inventoryRecords.has("Rollback Book"), false);
  assert.equal(idempotencyRecords.has("rolled-back-request"), false);

  idempotencyRecords.get(order.idempotencyKey).request_hash = null;
  const migratedRetry = await secondInstance.addOrderIdempotently(order, requestHash);
  assert.equal(migratedRetry.replayed, true);
  assert.equal(idempotencyRecords.get(order.idempotencyKey).request_hash, requestHash);

  const changedOrder = { ...order, orderId: "changed-order", total: 99 };
  const changedPayload = await secondInstance.addOrderIdempotently(
    changedOrder,
    hashOrderRequest(changedOrder),
  );
  assert.equal(changedPayload.conflict, true);
  assert.equal(collections.get("orders").length, 1);

  const raceOrders = ["race-request-one", "race-request-two"].map((idempotencyKey) => {
    const raceOrder = {
      ...order,
      orderId: `${idempotencyKey}-order`,
      idempotencyKey,
      items: [{ title: "Race Book", quantity: 2 }],
    };
    return {
      raceOrder,
      requestHash: hashOrderRequest(raceOrder),
    };
  });
  const raceResults = await Promise.allSettled(raceOrders.map(({ raceOrder, requestHash }) => (
    firstInstance.addOrderIdempotently(
      raceOrder,
      requestHash,
      [{ title: "Race Book", quantity: 2, stock: 2 }],
    )
  )));
  assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
  assert.deepEqual(inventoryRecords.get("Race Book"), { stock: 2, reserved: 2 });
  assert.equal(collections.get("orders").length, 2);

  const secondOrder = {
    ...order,
    orderId: "second-order",
    idempotencyKey: "another-shared-request",
  };
  await assert.rejects(
    secondInstance.addOrderIdempotently(
      secondOrder,
      hashOrderRequest(secondOrder),
      [{ title: "Test Book", quantity: 1, stock: 1 }],
    ),
    /vượt quá tồn kho/,
  );
  assert.equal(collections.get("orders").length, 2);
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 1, reserved: 1 });

  const updatedItems = [{
    title: "Test Book",
    author: "Test Author",
    unitPrice: 25,
    quantity: 2,
    lineTotal: 50,
  }];
  const updateOptions = {
    inventory: [{ title: "Test Book", stock: 1 }],
    totals: { subtotal: 50, discount: 0, total: 50 },
  };
  await assert.rejects(
    firstInstance.updateOrderStatus("shared-order", { items: updatedItems }, undefined, updateOptions),
    /vượt quá tồn kho/,
  );
  assert.equal(collections.get("orders").find((entry) => entry.orderId === "shared-order").items[0].quantity, 1);
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 1, reserved: 1 });

  failOrderWrite = true;
  await assert.rejects(
    firstInstance.updateOrderStatus(
      "shared-order",
      { items: updatedItems },
      undefined,
      {
        ...updateOptions,
        inventory: [{ title: "Test Book", stock: 2 }],
      },
    ),
    /order write failed/,
  );
  failOrderWrite = false;
  assert.equal(collections.get("orders").find((entry) => entry.orderId === "shared-order").items[0].quantity, 1);
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 1, reserved: 1 });

  const updatedOrder = await firstInstance.updateOrderStatus(
    "shared-order",
    { items: updatedItems },
    undefined,
    {
      ...updateOptions,
      inventory: [{ title: "Test Book", stock: 2 }],
    },
  );
  assert.equal(updatedOrder.items[0].quantity, 2);
  assert.equal(updatedOrder.total, 50);
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 2, reserved: 2 });
  assert.equal(idempotencyRecords.get(order.idempotencyKey).order_record.items[0].quantity, 2);

  const cancelled = await secondInstance.updateOrderStatus("shared-order", {
    status: "cancelled",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 2, reserved: 0 });
  await secondInstance.updateOrderStatus("shared-order", { status: "cancelled" });
  assert.deepEqual(inventoryRecords.get("Test Book"), { stock: 2, reserved: 0 });
});

test("connection failures from pool.connect are propagated", async (t) => {
  withAdminConfig(t);
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT records")) return { rows: [{ records: [] }] };
      return { rows: [] };
    },
    async connect() {
      throw new Error("connection timeout");
    },
  };
  const db = new PostgresDatabase({ pool });
  await assert.rejects(db.updateCollection("customers", () => null), /connection timeout/);
  t.after(() => db.close().catch(() => {}));
});

test("PostgresDatabase supports the shared persistence workflows", async (t) => {
  withAdminConfig(t);
  const records = new Map([
    ["users", [{ id: "user-1", name: "Reader", email: "reader@example.com", password: "old", role: "user" }]],
    ["customers", []],
    ["orders", [{ orderId: "order-1", status: "received", total: 120 }]],
    ["services", []],
    ["books", []],
  ]);
  const queries = [];
  const read = (collection) => records.get(collection) || [];
  const write = (collection, value) => records.set(collection, JSON.parse(value));
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT records FROM booknest_data")) {
        const collection = values[0] || "users";
        return { rows: [{ records: read(collection) }] };
      }
      if (sql.includes("UPDATE booknest_data SET records")) write(values[0], values[1]);
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          queries.push({ sql, values });
          if (sql.includes("INSERT INTO booknest_data")) {
            const collection = values[0] || "orders";
            if (!records.has(collection)) records.set(collection, []);
          } else if (sql.includes("SELECT records FROM booknest_data")) {
            const collection = values[0] || "orders";
            return { rows: [{ records: read(collection) }] };
          } else if (sql.includes("UPDATE booknest_data SET records")) {
            if (values.length > 1) write(values[0], values[1]);
            else write("orders", values[0]);
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  assert.equal((await db.getUsers()).length, 2);
  assert.equal((await db.findUserByEmail(" READER@example.com ")).id, "user-1");
  assert.equal((await db.findUserById("user-1")).email, "reader@example.com");
  assert.equal(await db.findUserByEmail(""), null);
  const reset = await db.createPasswordResetToken("reader@example.com", "hash-1", "2099-01-01T00:00:00.000Z");
  assert.equal(reset.id, "user-1");
  assert.equal(await db.clearPasswordResetToken("hash-1"), true);
  await db.createPasswordResetToken("reader@example.com", "hash-2", "2099-01-01T00:00:00.000Z");
  assert.equal(await db.resetPassword("hash-2", "new-password"), "user-1");
  assert.equal(await db.clearPasswordResetToken("hash-2"), false);
  const createdUser = await db.createUser({
    name: "Second Reader", email: "second@example.com", password: "password-123", role: "support",
  });
  assert.equal(createdUser.role, "support");
  await db.updateCustomerInfo("user-1", { phone: "0123" }, "staff");
  assert.equal((await db.findOrCreateSocialUser({ email: "reader@example.com", authProvider: "google" })).id, "user-1");
  const socialUser = await db.findOrCreateSocialUser({ email: "social@example.com", name: "Social Reader" });
  assert.equal(socialUser.role, "user");

  const customer = await db.createCustomer({ name: "A Customer", email: "customer@example.com", phone: "0901234567" }, "staff");
  assert.equal((await db.getCustomerById(customer.id)).status, "new");
  assert.equal((await db.updateCustomer(customer.id, { name: "Updated Customer" }, "staff")).name, "Updated Customer");
  assert.equal((await db.updateCustomerStatus(customer.id, "lead", "staff")).status, "lead");
  assert.equal((await db.updateCustomerStatus(customer.id, "customer", "staff")).status, "customer");
  assert.equal(await db.softDeleteCustomer(customer.id, "staff"), true);
  assert.equal((await db.getCustomers()).length, 0);

  assert.equal((await db.getAllOrders()).length, 1);
  await db.addOrder({ orderId: "order-2", status: "received", total: 50 });
  assert.equal((await db.findOrderById("order-2")).total, 50);
  assert.equal((await db.updateOrderStatus("order-2", { status: "processing", paymentStatus: "paid" })).status, "processing");
  const service = await db.addServiceRequest({ service: "rent", bookTitle: "Book", name: "Reader", phone: "0902" });
  assert.equal((await db.getServiceRequests()).length, 1);
  assert.equal((await db.updateServiceRequestStatus(service.id, "completed")).status, "completed");

  const book = await db.addCustomBook({ title: "Custom Book", author: "Author", price: 10 });
  assert.equal((await db.getCustomBooks()).length, 1);
  assert.equal((await db.updateCustomBook(book.id, { title: "Updated Book" })).title, "Updated Book");
  assert.equal(await db.deleteCustomBook(book.id), true);
  assert.equal((await db.getStats()).totalUsers >= 3, true);
  assert.ok(queries.some(({ sql }) => sql.includes("COMMIT")));
});
