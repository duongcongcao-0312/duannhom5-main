const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");


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
