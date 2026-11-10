const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createServer } = require("../server");

const previousAdminEnvironment = {
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

after(() => {
  for (const [key, value] of Object.entries(previousAdminEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureTestAdmin() {
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "local-test-admin-password-123";
}

test("admin order updates reject null payloads without crashing", async (t) => {
  configureTestAdmin();
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-order-null-test-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const server = createServer({ ordersPath, usersPath, servicesPath });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "local-test-admin-password-123" }),
  });
  assert.equal(adminLoginRes.status, 200);
  const adminToken = (await adminLoginRes.json()).token;

  await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "123 Đường Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });

  const orderId = (await (await fetch(`${baseUrl}/api/admin/orders`, { headers: { Authorization: `Bearer ${adminToken}` } })).json())[0].orderId;

  const badStatusRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: "null",
  });

  assert.equal(badStatusRes.status, 400);
  const badStatusBody = await badStatusRes.json();
  assert.match(String(badStatusBody.error || badStatusBody.message || ""), /không hợp lệ|invalid|dữ liệu/i);
});

test("admin book catalog validates changes and persists stock and category updates", async (t) => {
  configureTestAdmin();
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-books-test-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    booksPath: path.join(temporaryDirectory, "books.json"),
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "local-test-admin-password-123",
    }),
  });
  assert.equal(adminLoginRes.status, 200);
  const { token } = await adminLoginRes.json();
  const adminHeaders = { Authorization: `Bearer ${token}` };

  const deniedCatalogRes = await fetch(`${baseUrl}/api/admin/books`);
  assert.equal(deniedCatalogRes.status, 401);

  const catalogRes = await fetch(`${baseUrl}/api/admin/books`, {
    headers: adminHeaders,
  });
  assert.equal(catalogRes.status, 200);
  const catalog = await catalogRes.json();
  const baseBook = catalog.find((book) => book.id.startsWith("catalog-"));
  assert.ok(baseBook);
  assert.equal(baseBook.isCustom, false);

  const updateBook = (changes, ifMatch = "") => fetch(
    `${baseUrl}/api/admin/books/${encodeURIComponent(baseBook.id)}`,
    {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
        "If-Match": ifMatch,
      },
      body: JSON.stringify({
        title: baseBook.title,
        author: baseBook.author,
        category: "ky-nang",
        price: baseBook.price,
        stock: 37,
        cover: baseBook.cover || "",
        description: baseBook.description || "",
        ...changes,
      }),
    },
  );

  const invalidStockRes = await updateBook({ stock: -1 });
  assert.equal(invalidStockRes.status, 400);
  const invalidCategoryRes = await updateBook({ category: "not-a-category" });
  assert.equal(invalidCategoryRes.status, 400);

  const duplicateBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: baseBook.title,
      author: "Tác giả khác",
      category: "van-hoc",
      price: 10000,
      stock: 1,
    }),
  });
  assert.equal(duplicateBookRes.status, 409);

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "123 Đường Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "cod",
      discountRate: 0,
      items: [{ title: baseBook.title, quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const belowReservedStockRes = await updateBook({ stock: 0 });
  assert.equal(belowReservedStockRes.status, 409);

  const updateRes = await updateBook({});
  assert.equal(updateRes.status, 200);
  const updatedBook = await updateRes.json();
  assert.equal(updatedBook.stock, 37);
  assert.equal(updatedBook.category, "ky-nang");
  assert.equal(updatedBook.isCustom, false);
  assert.ok(updatedBook.updatedAt);

  const staleUpdateRes = await updateBook({ stock: 38 });
  assert.equal(staleUpdateRes.status, 409);

  const customBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Sách thử quản lý",
      author: "Tác giả thử",
      category: "van-hoc",
      price: 50000,
      stock: 6,
    }),
  });
  assert.equal(customBookRes.status, 201);
  const customBook = await customBookRes.json();
  assert.equal(customBook.isCustom, true);

  const customUpdateRes = await fetch(
    `${baseUrl}/api/admin/books/${encodeURIComponent(customBook.id)}`,
    {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
        "If-Match": customBook.updatedAt || "",
      },
      body: JSON.stringify({
        title: customBook.title,
        author: customBook.author,
        category: customBook.category,
        price: customBook.price,
        stock: 8,
        cover: customBook.cover,
        description: customBook.description,
      }),
    },
  );
  assert.equal(customUpdateRes.status, 200);
  assert.equal((await customUpdateRes.json()).stock, 8);

  const customDeleteRes = await fetch(
    `${baseUrl}/api/admin/books/${encodeURIComponent(customBook.id)}`,
    { method: "DELETE", headers: adminHeaders },
  );
  assert.equal(customDeleteRes.status, 200);

  const publicCatalog = await (await fetch(`${baseUrl}/api/books`)).json();
  const reflectedBook = publicCatalog.find((book) => book.id === baseBook.id);
  assert.equal(reflectedBook.stock, 37);
  assert.equal(reflectedBook.category, "ky-nang");
  assert.equal(publicCatalog.some((book) => book.id === customBook.id), false);
});
