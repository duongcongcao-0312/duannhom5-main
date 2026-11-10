const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");

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

test("file database initialization is shared across concurrent reads", async (t) => {
  configureTestAdmin();
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-database-init-test-"),
  );
  const database = new Database({
    usersPath: path.join(temporaryDirectory, "users.json"),
  });
  t.after(() => fsPromises.rm(temporaryDirectory, { recursive: true, force: true }));

  const [firstInit, users, secondInit] = await Promise.all([
    database.init(),
    database.getUsers(),
    database.init(),
  ]);
  assert.equal(firstInit, undefined);
  assert.equal(secondInit, undefined);
  assert.equal(users.length, 1);
});

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

test("admin coupons enforce dates, minimum spend, and redemption limits on the server", async (t) => {
  configureTestAdmin();
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-coupons-test-"),
  );
  const database = new Database({
    root: temporaryDirectory,
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    booksPath: path.join(temporaryDirectory, "books.json"),
    couponsPath: path.join(temporaryDirectory, "coupons.json"),
  });
  await database.init();
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const booksPath = path.join(temporaryDirectory, "books.json");
  const couponsPath = path.join(temporaryDirectory, "coupons.json");
  const server = createServer({
    ordersPath,
    usersPath,
    servicesPath,
    booksPath,
    couponsPath,
    database,
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
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "local-test-admin-password-123",
    }),
  });
  const { token } = await login.json();
  const adminHeaders = { Authorization: `Bearer ${token}` };

  const deniedAdminRead = await fetch(`${baseUrl}/api/admin/coupons`);
  assert.equal(deniedAdminRead.status, 401);

  const createCoupon = (coupon) => fetch(`${baseUrl}/api/admin/coupons`, {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      code: coupon.code,
      label: coupon.label || coupon.code,
      rate: coupon.rate ?? 0.1,
      minSubtotal: coupon.minSubtotal ?? 0,
      maxUses: coupon.maxUses ?? 0,
      startsAt: coupon.startsAt || "",
      expiresAt: coupon.expiresAt || "",
      enabled: coupon.enabled ?? true,
    }),
  });

  const createdCouponRes = await createCoupon({
    code: "ONETIME",
    minSubtotal: 100000,
    maxUses: 1,
  });
  assert.equal(createdCouponRes.status, 201);
  const createdCoupon = await createdCouponRes.json();
  const adminCouponList = await fetch(`${baseUrl}/api/admin/coupons`, {
    headers: adminHeaders,
  });
  assert.equal(adminCouponList.status, 200);
  assert.ok((await adminCouponList.json()).some((coupon) => coupon.code === "ONETIME"));

  const expiredCouponRes = await createCoupon({
    code: "EXPIRED",
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(expiredCouponRes.status, 201);
  assert.equal(
    (await fetch(`${baseUrl}/api/coupons/EXPIRED`)).status,
    404,
  );

  const goodCouponRes = await fetch(`${baseUrl}/api/coupons/ONETIME`);
  assert.equal(goodCouponRes.status, 200);
  const publicCoupon = await goodCouponRes.json();
  assert.equal(publicCoupon.minSubtotal, 100000);
  assert.equal("usedCount" in publicCoupon, false);

  const quote = (couponCode, quantity) => fetch(`${baseUrl}/api/orders/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      couponCode,
      items: [{ title: "Nhà giả kim", quantity }],
    }),
  });
  const minimumQuote = await quote("ONETIME", 1);
  assert.equal(minimumQuote.status, 400);
  assert.match((await minimumQuote.json()).error, /tối thiểu/i);
  const eligibleQuote = await quote("ONETIME", 2);
  assert.equal(eligibleQuote.status, 200);
  assert.equal((await eligibleQuote.json()).discount, 17800);

  const createOrder = (idempotencyKey, couponCode = "ONETIME") => fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "123 Đường Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "cod",
      couponCode,
      discountRate: 0.1,
      subtotal: 1,
      discount: 0,
      total: 1,
      items: [{ title: "Nhà giả kim", quantity: 2 }],
    }),
  });
  const firstOrderRes = await createOrder("coupon-order-0001");
  assert.equal(firstOrderRes.status, 201);
  const firstOrder = await firstOrderRes.json();
  assert.equal(firstOrder.subtotal, 178000);
  assert.equal(firstOrder.discount, 17800);
  assert.equal(firstOrder.total, 160200);

  const exhaustedQuote = await quote("ONETIME", 2);
  assert.equal(exhaustedQuote.status, 400);
  assert.match((await exhaustedQuote.json()).error, /hết lượt/i);
  const secondOrderRes = await createOrder("coupon-order-0002");
  assert.equal(secondOrderRes.status, 400);

  const editPayload = {
    label: "Ưu đãi cập nhật",
    rate: 0.1,
    minSubtotal: 100000,
    maxUses: 1,
    startsAt: "",
    expiresAt: "",
    enabled: true,
  };
  const editCouponRes = await fetch(
    `${baseUrl}/api/admin/coupons/ONETIME`,
    {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
        "If-Match": createdCoupon.updatedAt,
      },
      body: JSON.stringify(editPayload),
    },
  );
  assert.equal(editCouponRes.status, 200);
  const editedCoupon = await editCouponRes.json();
  assert.equal(editedCoupon.label, "Ưu đãi cập nhật");
  const staleEditRes = await fetch(
    `${baseUrl}/api/admin/coupons/ONETIME`,
    {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
        "If-Match": createdCoupon.updatedAt,
      },
      body: JSON.stringify(editPayload),
    },
  );
  assert.equal(staleEditRes.status, 409);

  const raceCouponRes = await createCoupon({ code: "RACE" });
  assert.equal(raceCouponRes.status, 201);
  const originalRedeemCoupon = database.redeemCoupon.bind(database);
  database.redeemCoupon = async (code, subtotal, now, expectedRate) => {
    const coupon = (await database.getCoupons()).find((entry) => entry.code === code);
    await database.saveCoupon(
      { ...coupon, rate: 0.2 },
      coupon.updatedAt,
    );
    return originalRedeemCoupon(code, subtotal, now, expectedRate);
  };
  const changedRateOrder = await createOrder("coupon-order-race-01", "RACE");
  assert.equal(changedRateOrder.status, 409);
  assert.match((await changedRateOrder.json()).error, /điều kiện coupon vừa được cập nhật/i);

  const updatedCouponRes = await fetch(
    `${baseUrl}/api/admin/coupons/ONETIME`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
        "If-Match": editedCoupon.updatedAt,
      },
      body: JSON.stringify({ enabled: false }),
    },
  );
  assert.equal(updatedCouponRes.status, 200);
  assert.equal((await updatedCouponRes.json()).enabled, false);
});

test("admin audit log records staff actions with a hash chain", async (t) => {
  configureTestAdmin();
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-audit-test-"),
  );
  const auditLogPath = path.join(temporaryDirectory, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    auditLogPath,
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

  const staffCreateRes = await fetch(`${baseUrl}/api/admin/staff`, {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Nhân viên audit",
      email: "audit-staff@example.com",
      password: "audit-staff-password-123",
      role: "sales",
    }),
  });
  assert.equal(staffCreateRes.status, 201);
  const createdStaff = await staffCreateRes.json();

  const staffUpdateRes = await fetch(`${baseUrl}/api/admin/staff/${createdStaff.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Nhân viên audit đã cập nhật" }),
  });
  assert.equal(staffUpdateRes.status, 200);

  const auditRes = await fetch(`${baseUrl}/api/admin/audit`, {
    headers: adminHeaders,
  });
  assert.equal(auditRes.status, 200);
  const auditPayload = await auditRes.json();
  assert.ok(auditPayload.entries.some((entry) => entry.action === "staff.profile.create"));
  assert.ok(auditPayload.entries.some((entry) => entry.action === "staff.profile.update"));
  assert.ok(auditPayload.entries.every((entry) => typeof entry.hash === "string" && entry.hash.length === 64));
  assert.ok(auditPayload.entries.every((entry) => entry.action !== ""));
});
