const assert = require("node:assert/strict");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");

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
  assert.equal(queries.filter((entry) => entry.sql.includes("CREATE TABLE")).length, 1);
  assert.equal(queries.filter((entry) => entry.sql.includes("SELECT records")).length, 1);
  assert.equal(queries.filter((entry) => entry.sql.includes("INSERT INTO")).length, 1);
  await db.close();
  assert.equal(queries.at(-1).sql, "END");
});

test("initialization failure is propagated and can be retried", async () => {
  let attempts = 0;
  const pool = {
    async query(sql) {
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
  assert.equal(attempts, 2);
});

test("query timeout and query failure are surfaced without fallback data", async (t) => {
  withAdminConfig(t);
  const timeoutPool = {
    async query(sql) {
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
            if (!records.has(values[0])) records.set(values[0], []);
          } else if (sql.includes("SELECT records FROM booknest_data")) {
            return { rows: [{ records: read(values[0]) }] };
          } else if (sql.includes("UPDATE booknest_data SET records")) {
            write(values[0], values[1]);
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
