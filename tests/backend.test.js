const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hashPassword, verifyPassword } = require("../backend/auth");
const { Database } = require("../backend/db");
const { createEmailMailer } = require("../backend/email");
const { PostgresDatabase } = require("../backend/postgres-db");
const { createServer } = require("../server");

test("email delivery uses the HTTPS provider and exposes provider errors", async () => {
  const requests = [];
  const mailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "BookNest <no-reply@example.com>" },
    async (...args) => {
      requests.push(args);
      return new Response("", { status: 202 });
    },
  );
  await mailer.sendPasswordReset({
    to: "reader@example.com",
    name: "BookNest Reader",
    url: "https://example.com/#resetToken=token",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "https://api.resend.com/emails");
  assert.equal(requests[0][1].headers.Authorization, "Bearer test-api-key");
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    from: "BookNest <no-reply@example.com>",
    to: ["reader@example.com"],
    subject: "Khôi phục mật khẩu BookNest",
    text: "Xin chào BookNest Reader,\n\nĐể đặt lại mật khẩu BookNest, hãy mở liên kết sau trong vòng 1 giờ:\nhttps://example.com/#resetToken=token\n\nNếu bạn không yêu cầu khôi phục mật khẩu, hãy bỏ qua email này.",
  });

  const failingMailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "no-reply@example.com" },
    async () => new Response("domain is not verified", { status: 403 }),
  );
  await assert.rejects(
    failingMailer.sendPasswordReset({ to: "reader@example.com", name: "Reader", url: "https://example.com/" }),
    /Resend trả về HTTP 403: domain is not verified/,
  );
});

test("production server requires explicit admin credentials", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./server').createServer()"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        RENDER: "",
        DATABASE_URL: "",
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
        NODE_ENV: "production",
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production requires a valid ADMIN_EMAIL/);
});

test("Render backend refuses to start without a persistent database URL", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./server').createServer()"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        RENDER: "true",
        DATABASE_URL: "",
        NODE_ENV: "development",
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL phải được cấu hình trên Render/);
});

test("PostgreSQL uses TLS settings compatible with Render internal databases", async (t) => {
  const originalRender = process.env.RENDER;
  t.after(async () => {
    if (originalRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = originalRender;
  });

  process.env.RENDER = "true";
  const internalDatabase = new PostgresDatabase({
    connectionString: "postgres://user:password@dpg-test-a:5432/booknest",
  });
  assert.deepEqual(internalDatabase.pool.options.ssl, {
    rejectUnauthorized: false,
  });
  await internalDatabase.pool.end();

  const externalDatabase = new PostgresDatabase({
    connectionString: "postgres://user:password@dpg-test-a.oregon-postgres.render.com:5432/booknest",
  });
  assert.equal(externalDatabase.pool.options.ssl, true);
  await externalDatabase.pool.end();
});

test("configured admin credentials restore the admin account in file storage", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-recovery-"),
  );
  const usersPath = path.join(temporaryDirectory, "users.json");
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  t.after(async () => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await fsPromises.writeFile(
    usersPath,
    JSON.stringify([{
      id: "admin-master",
      name: "Quản trị viên BookNest",
      email: "admin@example.com",
      password: hashPassword("old-password"),
      role: "user",
    }]),
  );
  process.env.ADMIN_EMAIL = " ADMIN@example.com ";
  process.env.ADMIN_PASSWORD = "new-admin-password-123";

  const db = new Database({ usersPath });
  await db.init();
  const admin = await db.findUserByEmail("admin@example.com");

  assert.equal(admin.role, "admin");
  assert.equal(verifyPassword("new-admin-password-123", admin.password), true);
  assert.equal(verifyPassword("old-password", admin.password), false);
});

test("configured admin credentials restore the admin account in PostgreSQL", async (t) => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  let records = [{
    id: "admin-master",
    email: "admin@example.com",
    password: hashPassword("old-password"),
    role: "user",
  }];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("SELECT records FROM booknest_data")) {
        return { rows: [{ records }] };
      }
      if (sql.includes("INSERT INTO booknest_data")) {
        records = JSON.parse(values[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  t.after(() => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  process.env.ADMIN_EMAIL = " ADMIN@example.com ";
  process.env.ADMIN_PASSWORD = "new-admin-password-123";

  const db = new PostgresDatabase({ pool });
  await db.init();

  assert.equal(records[0].role, "admin");
  assert.equal(
    verifyPassword("new-admin-password-123", records[0].password),
    true,
  );
  assert.equal(verifyPassword("old-password", records[0].password), false);
});

test("backend APIs - coupons, auth, orders and admin workflow", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-backend-test-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const server = createServer({
    ordersPath,
    usersPath,
    servicesPath,
    corsOrigins: "https://shop.example",
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

  const preflight = await fetch(`${baseUrl}/api/orders`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://shop.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://shop.example");
  const rejectedPreflight = await fetch(`${baseUrl}/api/orders`, {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(rejectedPreflight.status, 403);

  // 1. Coupon API works
  const couponRes = await fetch(`${baseUrl}/api/coupons/BOOKNEST10`);
  assert.equal(couponRes.status, 200);
  const couponData = await couponRes.json();
  assert.equal(couponData.rate, 0.1);

  // 2. Auth: Admin login with seeded default account
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://shop.example",
    },
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" }),
  });
  assert.equal(adminLoginRes.status, 200);
  assert.equal(
    adminLoginRes.headers.get("access-control-allow-origin"),
    "https://shop.example",
  );
  assert.equal(
    adminLoginRes.headers.get("access-control-allow-credentials"),
    "true",
  );
  const adminData = await adminLoginRes.json();
  assert.ok(adminData.token);
  assert.equal(adminData.user.role, "admin");

  const adminToken = adminData.token;

  // 3. Auth: Register a regular user
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Trần Minh",
      email: "tranminh@example.com",
      password: "password123",
      studentType: "student",
      studentId: "HS-9988",
    }),
  });
  assert.equal(registerRes.status, 201);
  const regData = await registerRes.json();
  assert.equal(regData.user.name, "Trần Minh");

  const duplicateRegisterRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Tên khác",
      email: " TRANMINH@example.com ",
      password: "password456",
    }),
  });
  assert.equal(duplicateRegisterRes.status, 409);
  assert.match((await duplicateRegisterRes.json()).error, /đã được đăng ký/i);

  // 4. Auth: Profile lookup via token
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.email, "tranminh@example.com");

  // 5. Save customer information to the account
  const customerInfoRes = await fetch(`${baseUrl}/api/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regData.token}`,
    },
    body: JSON.stringify({
      customerName: "Trần Minh",
      phone: "0912345678",
      address: "123 Phố Sách Hà Nội",
    }),
  });
  assert.equal(customerInfoRes.status, 200);

  // 6. Place an order
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Trần Minh",
      address: "123 Phố Sách Hà Nội",
      phone: "0912345678",
      paymentMethod: "transfer",
      discountRate: 0.1,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderData = await orderRes.json();

  // 7. Profile includes saved customer information
  const updatedMeRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regData.token}` },
  });
  const updatedMe = await updatedMeRes.json();
  assert.equal(updatedMe.user.customerInfo.address, "123 Phố Sách Hà Nội");

  // 8. Admin: View orders
  const adminOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminOrdersRes.status, 200);
  const adminOrders = await adminOrdersRes.json();
  assert.ok(adminOrders.length >= 1);
  assert.equal(adminOrders[0].orderId, orderData.orderId);

  // 9. Admin: Update order status to 'processing'
  const patchOrderRes = await fetch(
    `${baseUrl}/api/admin/orders/${orderData.orderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: "processing", paymentStatus: "paid" }),
    },
  );
  assert.equal(patchOrderRes.status, 200);
  const patchedOrder = await patchOrderRes.json();
  assert.equal(patchedOrder.status, "processing");
  assert.equal(patchedOrder.paymentStatus, "paid");

  // 10. Service request API
  const serviceRes = await fetch(`${baseUrl}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: "rent",
      bookTitle: "Đắc Nhân Tâm",
      condition: "new",
      name: "Lê Hoàng",
      phone: "0987654321",
      note: "Thuê trong 2 tuần",
    }),
  });
  assert.equal(serviceRes.status, 201);

  // 11. Admin Stats API
  const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalOrders >= 1);
  assert.ok(stats.totalUsers >= 2);
});

test("registration returns a JSON service error when user persistence is unavailable", async (t) => {
  const server = createServer({
    database: {
      async getCustomBooks() {
        return [];
      },
      async createUser() {
        throw new Error("database connection unavailable");
      },
    },
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Reader",
      email: "new-reader@example.com",
      password: "password123",
    }),
  });
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.match((await response.json()).error, /không thể lưu tài khoản/i);
});

test("password reset emails a single-use link and replaces the account password", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-password-reset-test-"),
  );
  const sentEmails = [];
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    appBaseUrl: "https://shop.example/booknest/",
    passwordResetMailer: {
      async sendPasswordReset(email) {
        sentEmails.push(email);
      },
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
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Reset User",
      email: "reset@example.com",
      password: "original-password",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const originalSession = (await registerResponse.json()).token;

  const requestReset = async (email) => fetch(`${baseUrl}/api/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const missingEmailResponse = await requestReset("missing@example.com");
  const resetResponse = await requestReset("reset@example.com");
  assert.equal(resetResponse.status, 200);
  assert.deepEqual(await resetResponse.json(), await missingEmailResponse.json());
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "reset@example.com");

  const resetUrl = new URL(sentEmails[0].url);
  assert.equal(resetUrl.origin, "https://shop.example");
  assert.equal(resetUrl.pathname, "/booknest/");
  assert.equal(resetUrl.search, "");
  const token = new URLSearchParams(resetUrl.hash.slice(1)).get("resetToken");
  assert.match(token, /^[a-f0-9]{64}$/);
  const storedUser = JSON.parse(
    await fsPromises.readFile(path.join(temporaryDirectory, "users.json"), "utf8"),
  ).find((user) => user.email === "reset@example.com");
  assert.notEqual(storedUser.passwordReset.tokenHash, token);

  const confirmResponse = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "new-password-123" }),
  });
  assert.equal(confirmResponse.status, 200);

  const invalidatedSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${originalSession}` },
  });
  assert.equal(invalidatedSession.status, 401);

  const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "reset@example.com", password: "original-password" }),
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "reset@example.com", password: "new-password-123" }),
  });
  assert.equal(newPasswordLogin.status, 200);

  const reusedTokenResponse = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "another-password-123" }),
  });
  assert.equal(reusedTokenResponse.status, 400);
});

test("password reset reports missing email configuration instead of accepting the request", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-password-reset-config-test-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    appBaseUrl: "https://shop.example/",
    passwordResetMailer: null,
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com" }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /chưa được cấu hình email/i);
  assert.deepEqual(JSON.parse(
    await fsPromises.readFile(path.join(temporaryDirectory, "users.json"), "utf8"),
  )[0].passwordReset, undefined);
});

test("auth customer-info rejects null or malformed payloads without crashing", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-customer-info-test-"),
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
  const user = {
    name: "Test User",
    email: "test-user@example.com",
    password: "password123",
    role: "user",
  };

  await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  assert.equal(loginRes.status, 200);
  const token = (await loginRes.json()).token;

  const badPayloadRes = await fetch(`${baseUrl}/api/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "null",
  });

  assert.equal(badPayloadRes.status, 400);
  const badPayloadBody = await badPayloadRes.json();
  assert.match(String(badPayloadBody.error || badPayloadBody.message || ""), /không hợp lệ|invalid|dữ liệu/i);
});

test("admin order updates reject null payloads without crashing", async (t) => {
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
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" }),
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

test("customer management access is role-scoped and audit fields are recorded", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-rbac-test-"),
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
  const db = new Database({ usersPath, servicesPath, ordersPath });
  await db.createUser({
    name: "Nhân viên sales",
    email: "sales@example.com",
    password: "password123",
    role: "sales",
    createdBy: "admin@booknest.vn",
  });
  await db.createUser({
    name: "Khách hàng thường",
    email: "member@example.com",
    password: "password123",
    role: "user",
  });

  const salesLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales@example.com",
      password: "password123",
    }),
  });
  assert.equal(salesLoginRes.status, 200);
  const salesToken = (await salesLoginRes.json()).token;

  const salesOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${salesToken}` },
  });
  assert.equal(salesOrdersRes.status, 200);

  const salesUsersRes = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${salesToken}` },
  });
  assert.equal(salesUsersRes.status, 403);

  const userLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "member@example.com",
      password: "password123",
    }),
  });
  assert.equal(userLoginRes.status, 200);
  const memberToken = (await userLoginRes.json()).token;

  const memberStatsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert.equal(memberStatsRes.status, 403);

  const salesRecord = await db.findUserByEmail("sales@example.com");
  assert.equal(salesRecord.role, "sales");
  assert.equal(salesRecord.createdBy, "admin@booknest.vn");
  assert.ok(salesRecord.updatedAt);
});

test("customer management validation rejects invalid roles and duplicate users", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-user-validation-"),
  );
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const servicesPath = path.join(temporaryDirectory, "services.jsonl");
  const db = new Database({ usersPath, servicesPath, ordersPath });

  t.after(async () => {
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      db.createUser({
        name: "Bad role",
        email: "bad-role@example.com",
        password: "password123",
        role: "boss",
      }),
    /Vai trò người dùng không hợp lệ/,
  );

  await db.createUser({
    name: "Nguyễn Anh",
    email: "anh@example.com",
    password: "password123",
    role: "user",
  });

  await assert.rejects(
    () =>
      db.createUser({
        name: "Nguyễn Anh Lặp",
        email: "anh@example.com",
        password: "password456",
        role: "user",
      }),
    /Email này đã được đăng ký/,
  );

  const savedUser = await db.findUserByEmail("anh@example.com");
  assert.equal(savedUser.role, "user");
  assert.ok(savedUser.createdAt);
  assert.ok(savedUser.updatedAt);
});

test("backend rejects invalid service and status payloads", async (t) => {
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
    body: JSON.stringify({ email: "admin@booknest.vn", password: "admin123" }),
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
});
