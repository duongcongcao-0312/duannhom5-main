const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");

async function temporaryDatabase(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    directory,
    usersPath: path.join(directory, "users.json"),
    ordersPath: path.join(directory, "orders.jsonl"),
    servicesPath: path.join(directory, "services.jsonl"),
    customersPath: path.join(directory, "customers.json"),
    booksPath: path.join(directory, "books.json"),
  };
}

test("missing JSON files recover as empty stores without changing the API", async (t) => {
  const paths = await temporaryDatabase(t, "booknest-storage-missing-");
  const db = new Database(paths);
  assert.deepEqual(await db.getUsers(), []);
  assert.deepEqual(await db.getAllOrders(), []);
  assert.deepEqual(await db.getCustomers(), []);
});

test("custom book storage accepts valid arrays and recovers from invalid content", async (t) => {
  const paths = await temporaryDatabase(t, "booknest-storage-books-");
  const db = new Database(paths);
  await fs.writeFile(paths.booksPath, JSON.stringify([{ id: "book-1", title: "Existing" }]));
  assert.equal((await db.getCustomBooks())[0].title, "Existing");
  const created = await db.addCustomBook({ title: "Added", author: "Author", category: "", stock: 4 });
  assert.equal(created.stock, 4);
  const updated = await db.updateCustomBook("Added", {
    title: "Updated", author: "New Author", category: "", description: "Description", cover: "",
  });
  assert.equal(updated.title, "Updated");
  assert.equal(await db.deleteCustomBook("missing"), false);

  await fs.writeFile(paths.booksPath, JSON.stringify({ invalid: true }));
  assert.deepEqual(await db.getCustomBooks(), []);
  await fs.writeFile(paths.booksPath, "not-json");
  assert.deepEqual(await db.getCustomBooks(), []);
});

test("corrupt JSON fails explicitly while malformed JSONL records are isolated", async (t) => {
  const paths = await temporaryDatabase(t, "booknest-storage-corrupt-");
  await fs.writeFile(paths.usersPath, '{"users":');
  await fs.writeFile(
    paths.ordersPath,
    '{"orderId":"valid-order"}\nnot-json\n{"orderId":"second-order"}\n',
  );
  const db = new Database(paths);
  await assert.rejects(db.getUsers(), /Tệp tài khoản bị hỏng/);
  assert.deepEqual(
    (await db.getAllOrders()).map((order) => order.orderId),
    ["second-order", "valid-order"],
  );
  assert.equal(await fs.readFile(paths.ordersPath, "utf8"), '{"orderId":"valid-order"}\nnot-json\n{"orderId":"second-order"}\n');
});

test("concurrent order appends remain complete and independently parseable", async (t) => {
  const paths = await temporaryDatabase(t, "booknest-storage-concurrent-");
  const db = new Database(paths);
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      db.addOrder({ orderId: `order-${index}` }),
    ),
  );
  const orders = await db.getAllOrders();
  assert.equal(orders.length, 40);
  assert.equal(new Set(orders.map((order) => order.orderId)).size, 40);
});

test("permission and directory failures are surfaced instead of treated as empty data", async (t) => {
  const paths = await temporaryDatabase(t, "booknest-storage-permission-");
  await fs.mkdir(paths.usersPath);
  const db = new Database(paths);
  await assert.rejects(db.getUsers(), /EISDIR|directory/i);
  await fs.mkdir(paths.ordersPath);
  await assert.rejects(db.addOrder({ orderId: "blocked" }), /EISDIR|directory/i);
});
