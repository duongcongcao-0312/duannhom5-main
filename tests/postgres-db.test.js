const assert = require("node:assert/strict");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");

function withAdminConfig(t) {
  const originalEmail = process.env.ADMIN_EMAIL;
  const originalPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "strong-password-123";
  t.after(() => {
    if (originalEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalEmail;
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
  });
}

function createPool(overrides = {}) {
  const queries = [];
  const pool = {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM app_users")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          queries.push({ sql, values });
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async end() {},
    ...overrides,
  };
  return pool;
}

test("PostgresDatabase rejects a missing DATABASE_URL", () => {
  assert.throws(
    () => new PostgresDatabase({ connectionString: "" }),
    /DATABASE_URL là bắt buộc/,
  );
});

test("initialization provisions admin users in the relational table once", async (t) => {
  withAdminConfig(t);
  const pool = createPool();
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  await db.init();
  await db.init();

  assert.equal(pool.queries.filter(({ sql }) => sql.includes("CREATE TABLE")).length, 3);
  assert.equal(pool.queries.filter(({ sql }) => sql.includes("INSERT INTO app_users")).length, 1);
  assert.ok(pool.queries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS auth_sessions")));
  assert.ok(pool.queries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS payment_webhook_events")));
});

test("initialization errors are surfaced and can be retried", async (t) => {
  const originalEmail = process.env.ADMIN_EMAIL;
  const originalPassword = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  t.after(() => {
    if (originalEmail !== undefined) process.env.ADMIN_EMAIL = originalEmail;
    if (originalPassword !== undefined) process.env.ADMIN_PASSWORD = originalPassword;
  });
  let attempts = 0;
  const pool = createPool({
    async query(sql, values = []) {
      if (sql.includes("CREATE TABLE")) {
        attempts += 1;
        if (attempts === 1) throw new Error("connection refused");
      }
      if (sql.includes("FROM app_users")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  await assert.rejects(db.init(), /connection refused/);
  await assert.rejects(db.init(), /Đặt ADMIN_EMAIL/);
  assert.equal(attempts, 4);
});

test("PostgresDatabase stores only hashed session keys and enforces database expiry", async (t) => {
  withAdminConfig(t);
  const expiresAt = Date.now() + 60_000;
  const sessionData = {
    userId: "session-user",
    email: "session@example.com",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt,
  };
  const statements = [];
  const pool = createPool({
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM app_users")) return { rows: [] };
      if (sql.includes("SELECT session_data")) {
        return { rows: [{ session_data: sessionData, expires_at: new Date(expiresAt) }] };
      }
      if (sql.includes("DELETE FROM auth_sessions WHERE session_hash")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());
  const sessionHash = "a".repeat(64);

  await db.saveSessionRecord(sessionHash, { ...sessionData, token: "must-not-be-persisted" });
  const insert = statements.find(({ sql }) => sql.includes("INSERT INTO auth_sessions"));
  assert.equal(insert.values[0], sessionHash);
  assert.doesNotMatch(insert.values[2], /must-not-be-persisted/);
  assert.deepEqual(await db.getSessionRecord(sessionHash), { ...sessionData, expiresAt });
  assert.equal(await db.deleteSessionRecord(sessionHash), true);
  assert.match(statements.find(({ sql }) => sql.includes("SELECT session_data")).sql, /expires_at > NOW\(\)/);
});

test("collection reads use relational tables and map normalized rows", async (t) => {
  withAdminConfig(t);
  const queries = [];
  const pool = createPool({
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM app_users")) {
        return {
          rows: [{
            user_id: "reader-1",
            email: "reader@example.com",
            full_name: "Reader",
            password_hash: "hashed",
            role: "user",
            student_type: "other",
            student_id: "",
            auth_provider: null,
            provider_id: null,
            customer_info: {},
            password_reset: null,
            created_by: "system",
            updated_by: "system",
            created_at: new Date("2025-01-01T00:00:00.000Z"),
            updated_at: new Date("2025-01-02T00:00:00.000Z"),
            legacy_record: {},
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  const users = await db.getUsers();
  assert.equal(users[0].id, "reader-1");
  assert.equal(users[0].email, "reader@example.com");
  assert.equal(users[0].password, "hashed");
  assert.ok(queries.some(({ sql }) => sql.includes("FROM app_users")));
  assert.ok(queries.every(({ sql }) => !sql.includes("SELECT records")));
});

test("relational collection writes are transactional and persist product rows", async (t) => {
  withAdminConfig(t);
  const statements = [];
  const pool = createPool({
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes("SELECT * FROM store_products")) return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 1 };
        },
        release() { statements.push({ sql: "RELEASE" }); },
      };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  const added = await db.updateCollection("books", (books) => {
    books.push({
      id: "custom-book-1",
      title: "Custom Book",
      author: "Author",
      category: "van-hoc",
      price: 25000,
      stock: 3,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    return books[0];
  });

  assert.equal(added.title, "Custom Book");
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO store_products")));
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
  assert.equal(statements.at(-1).sql, "RELEASE");
});

test("coupon redemption is committed atomically with a PostgreSQL order", async (t) => {
  withAdminConfig(t);
  const statements = [];
  const pool = createPool({
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes("INSERT INTO order_idempotency")) {
            return { rows: [{ order_record: {} }], rowCount: 1 };
          }
          if (sql.includes("SELECT orders.*")) return { rows: [], rowCount: 0 };
          if (sql.includes("UPDATE coupon_promotions")) {
            return { rows: [{ code: "ONETIME" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() { statements.push({ sql: "RELEASE" }); },
      };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  const order = {
    orderId: "123e4567-e89b-12d3-a456-426614174000",
    idempotencyKey: "coupon-order-0001",
    subtotal: 100000,
    couponRate: 0.1,
    items: [],
  };
  const result = await db.addOrderIdempotently(
    order,
    "a".repeat(64),
    [],
    () => {},
    "ONETIME",
  );
  assert.equal(result.conflict, false);
  const redemptionIndex = statements.findIndex(({ sql }) => sql.includes("UPDATE coupon_promotions"));
  const orderCommitIndex = statements.findIndex(({ sql }) => sql === "COMMIT");
  assert.ok(redemptionIndex >= 0);
  assert.ok(redemptionIndex < orderCommitIndex);
  assert.equal(statements[redemptionIndex].values[0], "ONETIME");
  assert.equal(statements[redemptionIndex].values[1], 100000);
  assert.equal(statements[redemptionIndex].values[2], 0.1);
  assert.match(statements[redemptionIndex].sql, /AND rate = \$3/);
});

test("customer interactions use CRM tables with pagination and actor audit fields", async (t) => {
  withAdminConfig(t);
  const customerId = "11111111-1111-4111-8111-111111111111";
  const interactionId = "22222222-2222-4222-8222-222222222222";
  const createdAt = new Date("2026-01-02T03:04:05.000Z");
  const statements = [];
  const customerRow = {
    customer_id: customerId,
    full_name: "Reader",
    email: "reader@example.com",
    phone: "+84901234567",
    status: "customer",
    created_by: "admin",
    updated_by: "admin",
    created_at: createdAt,
    updated_at: createdAt,
    is_active: true,
    deleted_at: null,
    legacy_record: {},
  };
  let interactionRow = {
    id: interactionId,
    customer_id: customerId,
    type: "call",
    note: "Initial note",
    created_by: "sales-user",
    created_at: createdAt,
    updated_by: "sales-user",
    updated_at: createdAt,
  };
  const pool = createPool({
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM app_users")) return { rows: [] };
      if (sql.includes("SELECT * FROM customers")) return { rows: [customerRow] };
      if (sql.includes("count(*)::int AS total")) return { rows: [{ total: 3 }] };
      if (sql.includes("FROM customer_interactions") && sql.includes("ORDER BY")) {
        return { rows: [interactionRow] };
      }
      if (sql.includes("INSERT INTO customer_interactions")) {
        return { rows: [{
          ...interactionRow,
          id: "33333333-3333-4333-8333-333333333333",
          type: values[1],
          note: values[2],
          created_by: values[3],
          updated_by: values[3],
        }], rowCount: 1 };
      }
      if (sql.includes("UPDATE customer_interactions")) {
        interactionRow = {
          ...interactionRow,
          type: values[2] || interactionRow.type,
          note: values[3] || interactionRow.note,
          updated_by: values[4],
          updated_at: new Date(),
        };
        return { rows: [interactionRow], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM customer_interactions")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  const page = await db.getCustomerInteractions(customerId, { page: 2, limit: 1 });
  assert.deepEqual(page, {
    items: [{
      id: interactionId,
      customerId,
      type: "call",
      note: "Initial note",
      created_by: "sales-user",
      createdAt: createdAt.toISOString(),
      updated_by: "sales-user",
      updatedAt: createdAt.toISOString(),
    }],
    page: 2,
    limit: 1,
    total: 3,
  });
  assert.match(statements.find(({ sql }) => sql.includes("ORDER BY created_at DESC")).sql, /LIMIT \$2 OFFSET \$3/);

  const created = await db.createCustomerInteraction(
    customerId,
    { type: "chat", note: "Contacted customer" },
    "support-user",
  );
  assert.equal(created.created_by, "support-user");
  assert.equal(created.updated_by, "support-user");
  const insert = statements.find(({ sql }) => sql.includes("INSERT INTO customer_interactions"));
  assert.match(insert.sql, /WHERE customer_id = \$1::uuid AND is_active = TRUE/);
  assert.equal(insert.values[3], "support-user");

  const updated = await db.updateCustomerInteraction(
    customerId,
    interactionId,
    { note: "Follow-up completed" },
    "admin-user",
  );
  assert.equal(updated.note, "Follow-up completed");
  assert.equal(updated.created_by, "sales-user");
  assert.equal(updated.updated_by, "admin-user");
  assert.match(statements.find(({ sql }) => sql.includes("UPDATE customer_interactions")).sql, /interaction\.customer_id = \$2::uuid/);

  assert.equal(await db.deleteCustomerInteraction(customerId, interactionId), true);
  assert.match(statements.find(({ sql }) => sql.includes("DELETE FROM customer_interactions")).sql, /interaction\.customer_id = \$2::uuid/);
});

test("collection updates roll back when a mutator fails", async (t) => {
  withAdminConfig(t);
  const statements = [];
  const pool = createPool({
    async connect() {
      return {
        async query(sql) {
          statements.push(sql);
          if (sql.includes("SELECT * FROM app_users")) return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 0 };
        },
        release() { statements.push("RELEASE"); },
      };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  await assert.rejects(
    db.updateCollection("users", () => { throw new Error("mutation failed"); }),
    /mutation failed/,
  );
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.at(-1), "RELEASE");
});

test("payment webhook events are idempotent and update relational orders", async (t) => {
  withAdminConfig(t);
  const orderId = "11111111-1111-4111-8111-111111111111";
  const events = new Map();
  const order = {
    order_id: orderId,
    user_id: null,
    customer_name: "Reader",
    phone: "0901234567",
    address: "Address",
    payment_method: "transfer",
    status: "received",
    payment_status: "pending",
    coupon_code: null,
    discount_rate: 0,
    subtotal: 25000,
    discount: 0,
    total: 25000,
    idempotency_key: null,
    idempotency_hash: null,
    created_at: new Date("2025-01-01T00:00:00.000Z"),
    updated_at: new Date("2025-01-01T00:00:00.000Z"),
    legacy_record: {},
    items: [],
  };
  const pool = createPool({
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
            return { rows: [{ event_hash: events.get(values[0]) }], rowCount: 1 };
          }
          if (sql.includes("FROM store_orders orders")) return { rows: [{ ...order }] };
          if (sql.includes("INSERT INTO store_orders")) {
            order.payment_status = values[7];
            order.legacy_record = JSON.parse(values[17]);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  });
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());
  const event = {
    eventId: "payment-event-1",
    eventHash: "a".repeat(64),
    orderId,
    paymentStatus: "paid",
    amount: 25000,
    occurredAt: "2026-01-01T00:00:02.000Z",
  };

  const applied = await db.applyPaymentWebhookEvent(event);
  assert.equal(applied.order.paymentStatus, "paid");
  assert.equal(applied.duplicate, false);
  assert.equal((await db.applyPaymentWebhookEvent(event)).duplicate, true);
});
