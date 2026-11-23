"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");

function createTransactionalSpyPool(queryHandler) {
  const events = [];
  let released = 0;
  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const text = String(sql).trim();
          if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
            events.push(text);
            return { rows: [], rowCount: 0 };
          }
          events.push(text.split(/\s+/).slice(0, 3).join(" "));
          return queryHandler(text, params);
        },
        release() {
          released += 1;
        },
      };
    },
    async query(sql, params = []) {
      return queryHandler(String(sql).trim(), params);
    },
    async end() {},
  };
  return { pool, events, getReleased: () => released };
}

test("withTransaction commits on success and rolls back + releases client on mid-flight error", async () => {
  const okSpy = createTransactionalSpyPool(() => ({ rows: [{ ok: true }], rowCount: 1 }));
  const okDb = new PostgresDatabase({ pool: okSpy.pool });
  okDb.initialization = Promise.resolve();

  const res = await okDb.withTransaction(async (client) => {
    await client.query("UPDATE step_one SET x = 1");
    await client.query("UPDATE step_two SET y = 2");
    return "done";
  });
  assert.equal(res, "done");
  assert.equal(okSpy.events[0], "BEGIN");
  assert.equal(okSpy.events[okSpy.events.length - 1], "COMMIT");
  assert.equal(okSpy.getReleased(), 1);

  const failSpy = createTransactionalSpyPool((sql) => {
    if (sql.includes("step_two")) throw new Error("simulated step 2 failure");
    return { rows: [], rowCount: 1 };
  });
  const failDb = new PostgresDatabase({ pool: failSpy.pool });
  failDb.initialization = Promise.resolve();

  await assert.rejects(
    () => failDb.withTransaction(async (client) => {
      await client.query("UPDATE step_one SET x = 1");
      await client.query("UPDATE step_two SET y = 2");
    }),
    /simulated step 2 failure/,
  );
  assert.equal(failSpy.events[0], "BEGIN");
  assert.ok(failSpy.events.includes("ROLLBACK"));
  assert.ok(!failSpy.events.includes("COMMIT"));
  assert.equal(failSpy.getReleased(), 1);
});

test("addOrderIdempotently rolls back coupon & inventory changes if order persistence fails mid-flight", async () => {
  const spy = createTransactionalSpyPool((sql, params) => {
    if (sql.includes("INSERT INTO order_idempotency")) {
      return { rows: [{ idempotency_key: params[0] }], rowCount: 1 };
    }
    if (sql.includes("UPDATE coupon_promotions")) {
      return { rows: [{ code: "SAVE10" }], rowCount: 1 };
    }
    if (sql.includes("SET reserved = reserved + $2")) {
      return { rows: [{ book_title: params[0] }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO store_orders")) {
      throw new Error("simulated disk full during store_orders insert");
    }
    return { rows: [], rowCount: 0 };
  });
  const db = new PostgresDatabase({ pool: spy.pool });
  db.initialization = Promise.resolve();

  const order = {
    orderId: "00000000-0000-4000-8000-000000000101",
    idempotencyKey: "tx-order-rollback-0001",
    subtotal: 200000,
    discount: 20000,
    total: 180000,
    couponRate: 0.1,
    items: [{ title: "Nhà giả kim", quantity: 1, unitPrice: 200000 }],
  };

  await assert.rejects(
    () => db.addOrderIdempotently(
      order,
      "b".repeat(64),
      [{ title: "Nhà giả kim", quantity: 1, stock: 10 }],
      () => {},
      "SAVE10",
    ),
    /simulated disk full/,
  );
  assert.equal(spy.events[0], "BEGIN");
  assert.ok(spy.events.includes("ROLLBACK"), "mid-flight error must trigger ROLLBACK");
  assert.ok(!spy.events.includes("COMMIT"), "mid-flight error must never COMMIT partial state");
  assert.equal(spy.getReleased(), 1);
});

test("anonymizeUserAccount wraps user anonymization and session revocation in one atomic transaction", async () => {
  const spy = createTransactionalSpyPool((sql) => {
    if (sql.includes("SELECT * FROM app_users")) {
      return {
        rows: [{
          user_id: "u-anon-1",
          email: "anon@example.com",
          full_name: "Anon User",
          password_hash: "scrypt$N=16384,r=8,p=1$abcd$ef01",
          role: "user",
          student_type: "other",
          student_id: "",
          customer_info: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("DELETE FROM auth_sessions")) {
      throw new Error("simulated auth_sessions delete failure");
    }
    return { rows: [], rowCount: 1 };
  });
  const db = new PostgresDatabase({ pool: spy.pool });
  db.initialization = Promise.resolve();

  await assert.rejects(
    () => db.anonymizeUserAccount("u-anon-1", "admin-1", "admin"),
    /simulated auth_sessions delete failure/,
  );
  assert.equal(spy.events[0], "BEGIN");
  assert.ok(spy.events.includes("ROLLBACK"), "failure during session deletion must roll back user anonymization");
  assert.ok(!spy.events.includes("COMMIT"));
  assert.equal(spy.getReleased(), 1);
});

test("saveCoupon and updatePrivacyDataRequest roll back and release client on mid-flight errors", async () => {
  const couponSpy = createTransactionalSpyPool((sql) => {
    if (sql.includes("SELECT * FROM coupon_promotions")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO coupon_promotions")) throw new Error("coupon upsert failed");
    return { rows: [], rowCount: 0 };
  });
  const couponDb = new PostgresDatabase({ pool: couponSpy.pool });
  couponDb.initialization = Promise.resolve();

  await assert.rejects(
    () => couponDb.saveCoupon({
      code: "TXTEST",
      label: "TX Test",
      rate: 0.1,
      minSubtotal: 0,
      maxUses: 10,
      startsAt: null,
      expiresAt: null,
      enabled: true,
    }),
    /coupon upsert failed/,
  );
  assert.equal(couponSpy.events[0], "BEGIN");
  assert.ok(couponSpy.events.includes("ROLLBACK"));
  assert.equal(couponSpy.getReleased(), 1);
});
