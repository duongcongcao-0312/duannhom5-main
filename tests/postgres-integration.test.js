const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");

const databaseUrl = String(process.env.DATABASE_URL || "").trim();

test("PostgreSQL real service supports empty initialization, CRUD, rollback, and cleanup", {
  skip: !databaseUrl,
}, async () => {
  const suffix = crypto.randomUUID();
  const email = `integration-${suffix}@example.com`;
  const phone = `090${Date.now().toString().slice(-9)}`;
  const db = new PostgresDatabase({ connectionString: databaseUrl });
  let user;
  let customer;
  const orderId = crypto.randomUUID();

  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || `admin-${suffix}@example.com`;
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || `integration-password-123`;

  try {
    await db.init();

    user = await db.createUser({
      name: "Integration User",
      email,
      password: "integration-password-123",
      role: "user",
      createdBy: "integration-test",
    });
    assert.equal((await db.findUserByEmail(email)).id, user.id);

    customer = await db.createCustomer({
      name: "Integration Customer",
      email,
      phone,
    }, user.id);
    assert.equal((await db.getCustomerById(customer.id)).id, customer.id);

    await db.addOrder({
      orderId,
      status: "received",
      paymentStatus: "cod_pending",
      items: [],
      total: 0,
    });
    assert.equal((await db.findOrderById(orderId)).orderId, orderId);

    await assert.rejects(
      db.updateCollection("orders", (orders) => {
        orders.push({ orderId: crypto.randomUUID(), total: 999 });
        throw new Error("forced transaction rollback");
      }),
      /forced transaction rollback/,
    );
    assert.equal((await db.findOrderById(orderId)).total, 0);
  } finally {
    await db.updateCollection("orders", (orders) => {
      const index = orders.findIndex((order) => order.orderId === orderId);
      if (index >= 0) orders.splice(index, 1);
    }).catch(() => {});
    if (customer) {
      await db.deleteCustomer(customer.id, user.id).catch(() => {});
    }
    await db.updateCollection("users", (users) => {
      const index = users.findIndex((entry) => entry.email === email);
      if (index >= 0) users.splice(index, 1);
    }).catch(() => {});
    await db.close();
  }
});
