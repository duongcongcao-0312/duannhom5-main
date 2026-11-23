"use strict";

const assert = require("node:assert/strict");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "deletion-admin-pass-12345";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("governed deletion/anonymization workflow anonymizes account, revokes sessions, deletes saved addresses, purges active exports, preserves accounting orders, and logs minimal audit", async (t) => {
  configureAdminEnv(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-deletion-flow-"));
  const auditLogPath = path.join(directory, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    addressesPath: path.join(directory, "addresses.json"),
    auditLogPath,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Register user, create saved address, order, and active privacy export
  const userPass = "delete-me-secret-pass-123";
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Nguyễn Xóa Dữ Liệu",
      email: "delete-me@example.com",
      password: userPass,
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: userToken, user } = await regRes.json();

  const addrRes = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      recipientName: "Nguyễn Xóa Dữ Liệu",
      phone: "0909333444",
      addressLine: "99 Đường Cần Xóa, Quận 1",
    }),
  });
  assert.equal(addrRes.status, 201);
  const { address } = await addrRes.json();

  const orderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      customerName: "Nguyễn Xóa Dữ Liệu",
      address: address.addressLine,
      addressId: address.id,
      phone: address.phone,
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = await orderRes.json();

  const exportRes = await fetch(`${baseUrl}/api/v1/privacy/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ format: "json", currentPassword: userPass }),
  });
  assert.equal(exportRes.status, 201);
  const { export: activeExport } = await exportRes.json();

  // 2. Direct ungoverned DELETE /api/v1/users/:id is rejected with 403 GOVERNED_DELETION_REQUIRED
  const directDelete = await fetch(`${baseUrl}/api/v1/users/${user.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.equal(directDelete.status, 403);
  assert.equal((await directDelete.json()).code, "GOVERNED_DELETION_REQUIRED");

  // 3. User submits governed DSAR delete request
  const dsarRes = await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ type: "delete", channel: "web_portal" }),
  });
  assert.equal(dsarRes.status, 201);
  const { request: dsar } = await dsarRes.json();

  // 4. Admin executes governed anonymization
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "deletion-admin-pass-12345",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const execRes = await fetch(`${baseUrl}/api/v1/admin/privacy/data-requests/${dsar.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "completed", executeAnonymization: true }),
  });
  assert.equal(execRes.status, 200);
  const execBody = await execRes.json();
  assert.equal(execBody.anonymized, true);
  assert.equal(execBody.addressesDeleted, 1);
  assert.equal(execBody.exportsPurged, 1);

  // 5. Verify session revoked, login disabled, saved address deleted, active export purged, accounting order preserved
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${userToken}` } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "delete-me@example.com", password: userPass }),
    })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/addresses/${address.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })).status,
    404,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/privacy/exports/${activeExport.id}/download`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "X-Export-Token": activeExport.downloadToken,
      },
    })).status,
    404,
  );
  const adminOrders = await (await fetch(`${baseUrl}/api/v1/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert.ok(adminOrders.some((o) => o.orderId === order.orderId), "Historical order must be preserved for accounting");

  // 6. Audit log records minimal anonymization entry with ZERO deleted PII
  const auditRaw = await fs.readFile(auditLogPath, "utf8");
  assert.match(auditRaw, /privacy\.account\.anonymize/);
  assert.doesNotMatch(auditRaw, /delete-me@example\.com|0909333444|99 Đường Cần Xóa|Nguyễn Xóa Dữ Liệu/);

  // 7. Public guide and internal procedure doc exist and cover required elements
  const root = path.join(__dirname, "..");
  const privacyHtml = fsSync.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(privacyHtml, /id="dataDeletionGuide"/);
  assert.match(privacyHtml, /72 giờ/);

  const doc = fsSync.readFileSync(
    path.join(root, "docs", "data-deletion-anonymization-procedure.md"),
    "utf8",
  );
  assert.match(doc, /GOVERNED_DELETION_REQUIRED/);
  assert.match(doc, /deleteByUser/);
  assert.match(doc, /purgeUserExports/);
  assert.match(doc, /privacy\.account\.anonymize/);
});
