const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function configureTestAdmin(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "local-test-admin-password-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("backend rejects invalid service and status payloads", async (t) => {
  configureTestAdmin(t);
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-invalid-payloads-"),
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

  const invalidServiceRes = await fetch(`${baseUrl}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: "unknown",
      bookTitle: "Đắc Nhân Tâm",
      condition: "new",
      name: "Lê Hoàng",
      phone: "0987654321",
      note: "Thuê trong 2 tuần",
    }),
  });
  assert.equal(invalidServiceRes.status, 400);

  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "local-test-admin-password-123" }),
  });
  assert.equal(adminLoginRes.status, 200);
  const adminToken = (await adminLoginRes.json()).token;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "a1".repeat(32),
      discountRate: 0.05,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = await orderRes.json();

  const invalidStatusRes = await fetch(
    `${baseUrl}/api/admin/orders/${order.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: "not-a-real-status",
        paymentStatus: "paid",
      }),
    },
  );
  assert.equal(invalidStatusRes.status, 400);

  const invalidTransitionRes = await fetch(
    `${baseUrl}/api/admin/orders/${order.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "shipping" }),
    },
  );
  assert.equal(invalidTransitionRes.status, 400);

  const validTransitionRes = await fetch(
    `${baseUrl}/api/admin/orders/${order.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "processing" }),
    },
  );
  assert.equal(validTransitionRes.status, 200);
  assert.equal((await validTransitionRes.json()).status, "processing");

  const transferOrderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn B",
      address: "45 Đường Sách, Quận 3",
      phone: "0907654321",
      paymentMethod: "transfer",
      accessCode: "b2".repeat(32),
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(transferOrderRes.status, 201);
  const transferOrder = await transferOrderRes.json();

  const completedWithoutPaymentRes = await fetch(
    `${baseUrl}/api/admin/orders/${transferOrder.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "completed" }),
    },
  );
  assert.equal(completedWithoutPaymentRes.status, 400);

  const processingWithVerifiedPaymentRes = await fetch(
    `${baseUrl}/api/admin/orders/${transferOrder.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "processing", paymentStatus: "paid" }),
    },
  );
  assert.equal(processingWithVerifiedPaymentRes.status, 200);

  const shippingWithVerifiedPaymentRes = await fetch(
    `${baseUrl}/api/admin/orders/${transferOrder.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "shipping" }),
    },
  );
  assert.equal(shippingWithVerifiedPaymentRes.status, 200);

  const completedWithVerifiedPaymentRes = await fetch(
    `${baseUrl}/api/admin/orders/${transferOrder.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "completed" }),
    },
  );
  assert.equal(completedWithVerifiedPaymentRes.status, 200);
  assert.equal((await completedWithVerifiedPaymentRes.json()).paymentStatus, "paid");
});

test("JSON-writing endpoints reject non-JSON content types", async (t) => {
  configureTestAdmin(t);
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-content-type-validation-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
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

  const weakContentTypeLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ email: "reader@example.com", password: "password12345" }),
  });
  assert.equal(weakContentTypeLogin.status, 415);

  const weakContentTypeOrder = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "customerName=Test&address=Address&phone=0901234567",
  });
  assert.equal(weakContentTypeOrder.status, 415);

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "local-test-admin-password-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token } = await adminLogin.json();

  const weakContentTypeAdminPatch = await fetch(`${baseUrl}/api/admin/orders/00000000-0000-0000-0000-000000000000`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(weakContentTypeAdminPatch.status, 415);
});

test("shared API validation rejects malformed, oversized, unknown and unsafe inputs", async (t) => {
  configureTestAdmin(t);
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-shared-validation-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
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
  const jsonHeaders = { "Content-Type": "application/json" };

  for (const body of ["null", "[]", JSON.stringify({ email: 12, password: "pass123" })]) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders,
      body,
    });
    assert.equal(response.status, 400);
  }

  const unknownOrderField = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      customerName: "Nguyễn Văn A",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
      unexpected: true,
    }),
  });
  assert.equal(unknownOrderField.status, 400);

  const oversized = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "reader@example.com", password: "x".repeat(1024 * 1024) }),
  });
  assert.equal(oversized.status, 413);

  const unsafePath = await fetch(`${baseUrl}/api/orders/%2F`);
  assert.equal(unsafePath.status, 400);

  const invalidToken = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: "Bearer not-a-session-token" },
  });
  assert.equal(invalidToken.status, 401);

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      email: "admin@example.com",
      password: "local-test-admin-password-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token } = await adminLogin.json();
  for (const query of ["?unknown=value", "?page=1&page=2", "?limit=0"]) {
    const response = await fetch(`${baseUrl}/api/customers${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
  }
});

test("order creation calculates catalog prices and rejects invalid checkout data", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-order-pricing-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
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
  const validOrder = {
    customerName: "Nguyễn Văn A",
    address: "12 Đường Sách, Quận 1",
    phone: "0901234567",
    paymentMethod: "cod",
    accessCode: "a1".repeat(32),
    discountRate: 0.05,
    couponCode: "BOOKNEST10",
    subtotal: 1,
    discount: 1,
    total: 0,
    items: [{ title: "Nhà giả kim", quantity: 1, price: 1, lineTotal: 1 }],
  };
  const submitOrder = (order) =>
    fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

  const successResponse = await submitOrder(validOrder);
  assert.equal(successResponse.status, 201);
  const createdOrder = await successResponse.json();
  assert.equal(createdOrder.subtotal, 89000);
  assert.equal(createdOrder.discount, 8900);
  assert.equal(createdOrder.total, 80100);
  assert.equal(createdOrder.items[0].lineTotal, 89000);
  assert.equal(createdOrder.paymentStatus, "cod_pending");

  const forgedOrderFieldsResponse = await submitOrder({
    ...validOrder,
    userId: "another-user",
    role: "admin",
    paymentStatus: "paid",
  });
  assert.equal(forgedOrderFieldsResponse.status, 400);

  const anonymousDiscountAttempt = await submitOrder({
    ...validOrder,
    discountRate: 0.1,
    couponCode: "",
  });
  assert.equal(anonymousDiscountAttempt.status, 201);
  const anonymousOrder = await anonymousDiscountAttempt.json();
  assert.equal(anonymousOrder.discount, 0);
  assert.equal(anonymousOrder.total, 89000);

  const anonymousQuoteResponse = await fetch(`${baseUrl}/api/orders/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      discountRate: 0.1,
      couponCode: "BOOKNEST10",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(anonymousQuoteResponse.status, 200);
  const anonymousQuote = await anonymousQuoteResponse.json();
  assert.equal(anonymousQuote.discountRate, 0);
  assert.equal(anonymousQuote.discount, createdOrder.discount);
  assert.equal(anonymousQuote.total, createdOrder.total);

  const registerUser = async (email, studentType = "other") => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nguyễn Văn A",
        email,
        password: "password12345",
        studentType,
        studentId: studentType === "other" ? "" : "HS-1234",
      }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).token;
  };
  const regularToken = await registerUser("regular-discount@example.com");
  const regularOrderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regularToken}`,
    },
    body: JSON.stringify({
      ...validOrder,
      accessCode: undefined,
      discountRate: 0.1,
      couponCode: "",
    }),
  });
  assert.equal(regularOrderResponse.status, 201);
  const regularOrder = await regularOrderResponse.json();
  assert.equal(regularOrder.discount, 4450);
  const regularQuoteResponse = await fetch(`${baseUrl}/api/orders/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regularToken}`,
    },
    body: JSON.stringify({
      couponCode: "",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(regularQuoteResponse.status, 200);
  assert.equal((await regularQuoteResponse.json()).total, regularOrder.total);

  const studentToken = await registerUser(
    "student-discount@example.com",
    "student",
  );
  const studentOrderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentToken}`,
    },
    body: JSON.stringify({
      ...validOrder,
      accessCode: undefined,
      discountRate: 0,
      couponCode: "",
    }),
  });
  assert.equal(studentOrderResponse.status, 201);
  const studentOrder = await studentOrderResponse.json();
  assert.equal(studentOrder.discount, 4450);
  const studentQuoteResponse = await fetch(`${baseUrl}/api/orders/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentToken}`,
    },
    body: JSON.stringify({
      discountRate: 0,
      couponCode: "",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(studentQuoteResponse.status, 200);
  assert.equal((await studentQuoteResponse.json()).total, studentOrder.total);

  const invalidOrders = [
    { ...validOrder, items: [{ title: "Unknown book", quantity: 1 }] },
    { ...validOrder, items: [{ title: "Nhà giả kim", quantity: 0 }] },
    { ...validOrder, items: [{ title: "Nhà giả kim", quantity: 1.5 }] },
    { ...validOrder, items: [{ title: "Nhà giả kim", quantity: 13 }] },
    { ...validOrder, couponCode: "NOT-A-COUPON" },
    { ...validOrder, couponCode: 10 },
    { ...validOrder, paymentMethod: "cash" },
    { ...validOrder, customerName: undefined },
    { ...validOrder, address: 123 },
    { ...validOrder, phone: "abcdefghij" },
    { ...validOrder, discountRate: 0.2 },
  ];
  for (const invalidOrder of invalidOrders) {
    const response = await submitOrder(invalidOrder);
    assert.equal(response.status, 400);
  }
});

test("social auth registers and authenticates Google and Facebook accounts", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-social-auth-"));
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const server = createServer({
    ordersPath,
    usersPath,
    socialTokenVerifier: async (token) => {
      if (token === "valid-google-token") {
        return {
          email: "google.reader@gmail.com",
          name: "Nguyễn Văn Google",
          emailVerified: true,
          uid: "google-uid-12345",
          provider: "google.com",
        };
      }
      if (token === "valid-facebook-token") {
        return {
          email: "tran.fb@facebook.com",
          name: "Trần Facebook",
          emailVerified: true,
          uid: "fb-uid-99999",
          provider: "facebook.com",
        };
      }
      throw new Error("invalid test token");
    },
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

  const googleRes = await fetch(`${baseUrl}/api/auth/social`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-google-token",
    },
    body: JSON.stringify({
      name: "Nguyễn Văn Google",
      email: "google.reader@gmail.com",
      provider: "google.com",
      providerId: "google-uid-12345"
    })
  });
  assert.equal(googleRes.status, 200);
  const googleData = await googleRes.json();
  assert.ok(googleData.token);
  assert.equal(googleData.user.email, "google.reader@gmail.com");
  assert.equal(googleData.user.name, "Nguyễn Văn Google");
  assert.equal(googleData.user.authProvider, "google.com");

  const fbRes = await fetch(`${baseUrl}/api/auth/social`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-facebook-token",
    },
    body: JSON.stringify({
      name: "Trần Facebook",
      email: "tran.fb@facebook.com",
      provider: "facebook.com",
      providerId: "fb-uid-99999"
    })
  });
  assert.equal(fbRes.status, 200);
  const fbData = await fbRes.json();
  assert.ok(fbData.token);
  assert.equal(fbData.user.email, "tran.fb@facebook.com");

  const repeatGoogleRes = await fetch(`${baseUrl}/api/auth/social`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-google-token",
    },
    body: JSON.stringify({
      name: "Nguyễn Văn Google Mới",
      email: "google.reader@gmail.com",
      provider: "google.com"
    })
  });
  assert.equal(repeatGoogleRes.status, 200);
  const repeatData = await repeatGoogleRes.json();
  assert.equal(repeatData.user.id, googleData.user.id);

  const invalidRes = await fetch(`${baseUrl}/api/auth/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Email", email: "invalid-email" })
  });
  assert.equal(invalidRes.status, 401);
});

test("issue #112 - catalog pricing, coupon quota, discontinued/out-of-stock books, concurrent reservations, cancellation restock, and order state machine", async (t) => {
  configureTestAdmin(t);
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-issue-112-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    booksPath: path.join(temporaryDirectory, "books.json"),
    couponsPath: path.join(temporaryDirectory, "coupons.json"),
    auditLogPath: path.join(temporaryDirectory, "admin-audit.jsonl"),
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
  const jsonHeaders = { "Content-Type": "application/json" };

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      email: "admin@example.com",
      password: "local-test-admin-password-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();
  const adminHeaders = {
    ...jsonHeaders,
    Authorization: `Bearer ${adminToken}`,
  };

  const userRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: "Khách hàng 112",
      email: "customer112@example.com",
      password: "customer-password-123",
    }),
  });
  assert.equal(userRegister.status, 201);
  const { token: userToken } = await userRegister.json();
  const userHeaders = {
    ...jsonHeaders,
    Authorization: `Bearer ${userToken}`,
  };

  // 1. Out-of-stock, discontinued, and deleted books cannot be ordered
  const outOfStockBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Sách hết hàng 112",
      author: "Tác giả A",
      category: "van-hoc",
      price: 100000,
      stock: 0,
    }),
  });
  assert.equal(outOfStockBookRes.status, 201);

  const discontinuedBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Sách ngừng bán 112",
      author: "Tác giả B",
      category: "van-hoc",
      price: 100000,
      stock: 5,
      discontinued: true,
      isActive: false,
      status: "discontinued",
    }),
  });
  assert.equal(discontinuedBookRes.status, 201);

  const deletedBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Sách đã xóa 112",
      author: "Tác giả C",
      category: "van-hoc",
      price: 100000,
      stock: 5,
    }),
  });
  assert.equal(deletedBookRes.status, 201);
  const deletedBook = await deletedBookRes.json();
  const deleteRes = await fetch(`${baseUrl}/api/admin/books/${deletedBook.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deleteRes.status, 200);

  for (const unavailableTitle of [
    "Sách hết hàng 112",
    "Sách ngừng bán 112",
    "Sách đã xóa 112",
  ]) {
    const orderAttempt = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        customerName: "Khách hàng 112",
        address: "123 Đường Sách, Quận 1",
        phone: "0901234567",
        paymentMethod: "cod",
        items: [{ title: unavailableTitle, quantity: 1 }],
      }),
    });
    assert.equal(orderAttempt.status, 400, `Expected 400 for ${unavailableTitle}`);
  }

  // 2. Future, disabled, expired, and quota-limited coupons are enforced on the server
  const createCoupon = (coupon) =>
    fetch(`${baseUrl}/api/admin/coupons`, {
      method: "POST",
      headers: adminHeaders,
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

  assert.equal(
    (
      await createCoupon({
        code: "FUTURE10",
        startsAt: new Date(Date.now() + 3600_000).toISOString(),
        expiresAt: new Date(Date.now() + 7200_000).toISOString(),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await createCoupon({
        code: "DISABLED10",
        enabled: false,
      })
    ).status,
    201,
  );

  for (const invalidCoupon of ["FUTURE10", "DISABLED10"]) {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        customerName: "Khách hàng 112",
        address: "123 Đường Sách, Quận 1",
        phone: "0901234567",
        paymentMethod: "cod",
        couponCode: invalidCoupon,
        items: [{ title: "Nhà giả kim", quantity: 1 }],
      }),
    });
    assert.equal(res.status, 400);
  }

  // 3. Concurrent purchases cannot oversell limited stock, and cancellation restores stock
  const limitedBookRes = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Sách giới hạn 112",
      author: "Tác giả D",
      category: "kinh-te",
      price: 120000,
      stock: 4,
    }),
  });
  assert.equal(limitedBookRes.status, 201);

  const buyLimited = (quantity) =>
    fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        customerName: "Khách hàng 112",
        address: "123 Đường Sách, Quận 1",
        phone: "0901234567",
        paymentMethod: "transfer",
        subtotal: 1,
        discount: 999999,
        total: 1,
        items: [{ title: "Sách giới hạn 112", quantity, price: 1, unitPrice: 1, lineTotal: 1 }],
      }),
    });

  const concurrentResults = await Promise.all([
    buyLimited(2),
    buyLimited(2),
    buyLimited(2),
    buyLimited(2),
  ]);
  const statuses = concurrentResults.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 400, 400]);

  const createdOrders = await Promise.all(
    concurrentResults.filter((r) => r.status === 201).map((r) => r.json()),
  );
  for (const created of createdOrders) {
    assert.equal(created.subtotal, 240000);
    assert.equal(created.discount, 12000);
    assert.equal(created.total, 228000);
    assert.equal(created.paymentStatus, "pending");
    assert.equal(created.status, "received");
  }

  // Stock is now 0 remaining; another purchase of 2 must fail
  assert.equal((await buyLimited(2)).status, 400);

  // Customer cannot mark order as paid
  const targetOrderId = createdOrders[0].orderId;
  const customerPaidAttempt = await fetch(`${baseUrl}/api/orders/${targetOrderId}`, {
    method: "PATCH",
    headers: userHeaders,
    body: JSON.stringify({ paymentStatus: "paid" }),
  });
  assert.equal(customerPaidAttempt.status, 403);

  // Customer cancels the first order while in "received" status -> restores 2 units of stock
  const cancelRes = await fetch(`${baseUrl}/api/orders/${targetOrderId}`, {
    method: "PATCH",
    headers: userHeaders,
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelRes.status, 200);
  assert.equal((await cancelRes.json()).status, "cancelled");

  // Now purchasing 2 units succeeds because stock was restored on cancellation
  const restockedPurchase = await buyLimited(2);
  assert.equal(restockedPurchase.status, 201);
  const activeOrder = await restockedPurchase.json();

  // 4. Order lifecycle state machine enforcement
  // Admin cannot skip from received -> shipping or received -> completed
  const skipToShipping = await fetch(`${baseUrl}/api/admin/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "shipping" }),
  });
  assert.equal(skipToShipping.status, 400);

  // Admin transitions received -> processing
  const toProcessing = await fetch(`${baseUrl}/api/admin/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "processing", paymentStatus: "paid" }),
  });
  assert.equal(toProcessing.status, 200);

  // Customer can no longer cancel once order is in "processing" status
  const lateCustomerCancel = await fetch(`${baseUrl}/api/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: userHeaders,
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(lateCustomerCancel.status, 403);

  // Admin transitions processing -> shipping -> completed
  const toShipping = await fetch(`${baseUrl}/api/admin/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "shipping" }),
  });
  assert.equal(toShipping.status, 200);

  const toCompleted = await fetch(`${baseUrl}/api/admin/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "completed" }),
  });
  assert.equal(toCompleted.status, 200);

  // Terminal states cannot transition backward or to cancelled/processing
  const completedToCancelled = await fetch(`${baseUrl}/api/admin/orders/${activeOrder.orderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(completedToCancelled.status, 400);

  const cancelledToProcessing = await fetch(`${baseUrl}/api/admin/orders/${targetOrderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(cancelledToProcessing.status, 400);

  const cancelledToPaid = await fetch(`${baseUrl}/api/admin/orders/${targetOrderId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ paymentStatus: "paid" }),
  });
  assert.equal(cancelledToPaid.status, 400);
});
