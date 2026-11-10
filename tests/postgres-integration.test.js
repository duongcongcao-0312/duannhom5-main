const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");
const { hashOrderRequest } = require("../backend/order-idempotency");

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
  let book;
  let service;
  const orderId = crypto.randomUUID();
  const idempotentOrderId = crypto.randomUUID();
  const idempotencyKey = `integration-${suffix}`;
  const reservedBookTitle = `Reserved Book ${suffix}`;

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

    book = await db.addCustomBook({
      title: `Integration Book ${suffix}`,
      author: "Integration Author",
      price: 1500,
      stock: 3,
    });
    await db.addOrder({
      orderId,
      status: "received",
      paymentStatus: "cod_pending",
      items: [{ title: book.title, author: book.author, unitPrice: 1500, quantity: 1 }],
      subtotal: 1500,
      discount: 0,
      total: 1500,
    });
    assert.equal((await db.findOrderById(orderId)).items[0].title, book.title);
    await assert.rejects(db.deleteCustomBook(book.id));

    const idempotentOrder = {
      orderId: idempotentOrderId,
      idempotencyKey,
      userId: user.id,
      customerName: "Integration User",
      phone,
      address: "Integration address",
      paymentMethod: "cod",
      status: "received",
      paymentStatus: "cod_pending",
      subtotal: 1500,
      discount: 0,
      total: 1500,
      items: [{ title: reservedBookTitle, author: "Inventory Author", unitPrice: 1000, quantity: 1 }],
    };
    const requestHash = hashOrderRequest(idempotentOrder);
    const inventory = [{ title: reservedBookTitle, stock: 3, quantity: 1 }];
    const created = await db.addOrderIdempotently(idempotentOrder, requestHash, inventory);
    assert.equal(created.replayed, false);
    const replay = await db.addOrderIdempotently(
      { ...idempotentOrder, orderId: crypto.randomUUID() },
      requestHash,
      inventory,
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.order.orderId, idempotentOrderId);
    const conflictingReplay = await db.addOrderIdempotently(
      { ...idempotentOrder, total: 1600 },
      hashOrderRequest({ ...idempotentOrder, total: 1600 }),
      inventory,
    );
    assert.equal(conflictingReplay.conflict, true);
    assert.equal((await db.pool.query(
      "SELECT reserved FROM book_inventory WHERE book_title = $1",
      [reservedBookTitle],
    )).rows[0].reserved, 1);

    service = await db.addServiceRequest({
      service: "rent",
      bookTitle: book.title,
      name: "Integration User",
      phone,
    });
    assert.equal((await db.getServiceRequests()).find((entry) => entry.id === service.id).service, "rent");

    await assert.rejects(db.pool.query(
      `INSERT INTO store_order_items
        (order_id, product_title, unit_price, quantity, line_total)
       VALUES ($1, $2, 1, 1, 1)`,
      [orderId, `missing-product-${suffix}`],
    ));

    await assert.rejects(
      db.updateCollection("orders", (orders) => {
        orders.push({ orderId: crypto.randomUUID(), total: 999 });
        throw new Error("forced transaction rollback");
      }),
      /forced transaction rollback/,
    );
    assert.equal((await db.findOrderById(orderId)).total, 1500);
  } finally {
    await db.updateCollection("orders", (orders) => {
      for (const id of [orderId, idempotentOrderId]) {
        const index = orders.findIndex((order) => order.orderId === id);
        if (index >= 0) orders.splice(index, 1);
      }
    }).catch(() => {});
    await db.pool.query("DELETE FROM order_idempotency WHERE idempotency_key = $1", [idempotencyKey])
      .catch(() => {});
    await db.pool.query("DELETE FROM book_inventory WHERE book_title = $1", [reservedBookTitle])
      .catch(() => {});
    await db.updateCollection("services", (services) => {
      const index = services.findIndex((entry) => entry.id === service?.id);
      if (index >= 0) services.splice(index, 1);
    }).catch(() => {});
    if (book) await db.deleteCustomBook(book.id).catch(() => {});
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
