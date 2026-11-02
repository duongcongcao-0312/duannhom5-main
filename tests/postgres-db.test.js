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
