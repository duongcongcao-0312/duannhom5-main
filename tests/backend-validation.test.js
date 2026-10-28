const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");


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

test("social auth registers and authenticates Google and Facebook accounts", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-social-auth-"));
  const ordersPath = path.join(temporaryDirectory, "orders.jsonl");
  const usersPath = path.join(temporaryDirectory, "users.json");
  const server = createServer({ ordersPath, usersPath });

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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
  assert.equal(invalidRes.status, 400);
});
