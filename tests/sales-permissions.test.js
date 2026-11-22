"use strict";

const assert = require("node:assert/strict");
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
  process.env.ADMIN_PASSWORD = "sales-perm-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-sales-perms-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    categoriesPath: path.join(directory, "categories.json"),
    authorsPath: path.join(directory, "authors.json"),
    publishersPath: path.join(directory, "publishers.json"),
    couponsPath: path.join(directory, "coupons.json"),
    addressesPath: path.join(directory, "addresses.json"),
    customersPath: path.join(directory, "customers.json"),
    customerInteractionsPath: path.join(directory, "customer-interactions.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
    uploadsDir: path.join(directory, "uploads"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("Sales role has allowed sales permissions and is blocked from out-of-scope admin actions, pricing/catalog edits, payment confirmation, deletions, and other users' personal data", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Login Admin and provision Sales staff account
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "sales-perm-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const createSales = await fetch(`${baseUrl}/api/v1/admin/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Sales Agent",
      email: "sales-agent@booknest.vn",
      password: "sales-agent-pass-123",
      role: "sales",
    }),
  });
  assert.equal(createSales.status, 201);
  const salesStaff = await createSales.json();

  const salesLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales-agent@booknest.vn",
      password: "sales-agent-pass-123",
    }),
  });
  assert.equal(salesLogin.status, 200);
  const { token: salesToken, user: salesUser } = await salesLogin.json();
  assert.equal(salesUser.role, "sales");

  // 2. Seed customer account, profile, address, order, privacy export, and service request
  const customerPass = "sales-customer-pass-123";
  const custReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Khách Hàng Sales",
      email: "khachhang-sales@example.com",
      password: customerPass,
    }),
  });
  assert.equal(custReg.status, 201);
  const customer = await custReg.json();

  const setProfile = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({
      customerName: "Khách Hàng Sales Private",
      phone: "0906222333",
      address: "33 Đường Riêng Tư Sales, Quận 3",
    }),
  });
  assert.equal(setProfile.status, 200);

  const addrRes = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({
      recipientName: "Khách Hàng Sales",
      phone: "0906222333",
      addressLine: "33 Đường Riêng Tư Sales, Quận 3",
      label: "Nhà Sales Cust",
    }),
  });
  assert.equal(addrRes.status, 201);
  const { address: customerAddress } = await addrRes.json();

  const orderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({
      customerName: "Khách Hàng Sales",
      address: customerAddress.addressLine,
      addressId: customerAddress.id,
      phone: customerAddress.phone,
      paymentMethod: "transfer",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderRes.status, 201);
  const customerOrder = await orderRes.json();

  const exportRes = await fetch(`${baseUrl}/api/v1/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: customerPass }),
  });
  assert.equal(exportRes.status, 201);
  const { export: customerExport } = await exportRes.json();

  const serviceRes = await fetch(`${baseUrl}/api/v1/services`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
    },
    body: JSON.stringify({
      bookTitle: "Nhà giả kim",
      name: "Khách Hàng Sales",
      phone: "0906222333",
      service: "rent",
    }),
  });
  assert.equal(serviceRes.status, 201);
  const { request: serviceRequest } = await serviceRes.json();

  const callAsSales = (method, endpoint, body) =>
    fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${salesToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // --- A. ALLOWED Sales operations (per permission matrix) ---
  // 1. Dashboard & monitoring read, public catalog read
  assert.equal((await callAsSales("GET", "/api/v1/admin/stats")).status, 200);
  assert.equal((await callAsSales("GET", "/api/v1/admin/monitoring")).status, 200);
  assert.equal((await callAsSales("GET", "/api/v1/books")).status, 200);

  // 2. Read admin orders and update workflow status (NOT paymentStatus)
  const listOrders = await callAsSales("GET", "/api/v1/admin/orders");
  assert.equal(listOrders.status, 200);
  assert.ok((await listOrders.json()).some((o) => o.orderId === customerOrder.orderId));

  const updateOrderStatus = await callAsSales(
    "PATCH",
    `/api/v1/admin/orders/${customerOrder.orderId}`,
    { status: "processing" },
  );
  assert.equal(updateOrderStatus.status, 200);
  assert.equal((await updateOrderStatus.json()).status, "processing");

  // 3. Read & update service requests
  assert.equal((await callAsSales("GET", "/api/v1/admin/services")).status, 200);
  const updateService = await callAsSales(
    "PATCH",
    `/api/v1/admin/services/${serviceRequest.id}`,
    { status: "processing" },
  );
  assert.equal(updateService.status, 200);
  assert.equal((await updateService.json()).status, "processing");

  // 4. CRM customers: read, create, update (NOT delete)
  const createCrmCust = await callAsSales("POST", "/api/v1/admin/customers", {
    name: "Sales Lead A",
    email: "sales-lead-a@example.com",
    phone: "0906444555",
  });
  assert.equal(createCrmCust.status, 201);
  const crmCustomer = await createCrmCust.json();

  assert.equal((await callAsSales("GET", "/api/v1/customers")).status, 200);
  assert.equal((await callAsSales("GET", `/api/v1/customers/${crmCustomer.id}`)).status, 200);
  const updateCrmCust = await callAsSales("PATCH", `/api/v1/admin/customers/${crmCustomer.id}`, {
    name: "Sales Lead Updated",
  });
  assert.equal(updateCrmCust.status, 200);

  // 5. CRM interactions: read, create, update (NOT delete)
  const createInteraction = await callAsSales(
    "POST",
    `/api/v1/admin/customers/${crmCustomer.id}/interactions`,
    { type: "call", note: "Tư vấn đơn hàng" },
  );
  assert.equal(createInteraction.status, 201);
  const interaction = await createInteraction.json();

  assert.equal((await callAsSales("GET", `/api/v1/customers/${crmCustomer.id}/interactions`)).status, 200);
  const updateInteraction = await callAsSales(
    "PATCH",
    `/api/v1/admin/customers/${crmCustomer.id}/interactions/${interaction.id}`,
    { note: "Đã gửi báo giá" },
  );
  assert.equal(updateInteraction.status, 200);

  // --- B. DENIED: Payment confirmation & destructive CRM deletes ---
  for (const [method, endpoint, body] of [
    ["PATCH", `/api/v1/admin/orders/${customerOrder.orderId}`, { paymentStatus: "paid" }],
    ["PUT", `/api/v1/admin/orders/${customerOrder.orderId}`, { paymentStatus: "paid" }],
    ["DELETE", `/api/v1/customers/${crmCustomer.id}`],
    ["DELETE", `/api/v1/admin/customers/${crmCustomer.id}`],
    ["DELETE", `/api/v1/customers/${crmCustomer.id}/interactions/${interaction.id}`],
    ["DELETE", `/api/v1/admin/customers/${crmCustomer.id}/interactions/${interaction.id}`],
  ]) {
    const res = await callAsSales(method, endpoint, body);
    assert.equal(res.status, 403, `Sales must get 403 on ${method} ${endpoint}`);
  }

  // --- C. DENIED: Catalog/pricing/coupons, users, staff, audit, privacy admin, role escalation ---
  const sampleId = "00000000-0000-4000-8000-000000000001";
  for (const [method, endpoint, body] of [
    ["GET", "/api/v1/admin/books"],
    ["POST", "/api/v1/admin/books", { title: "Rogue Book", category: "van-hoc", price: 1, stock: 10 }],
    ["PATCH", "/api/v1/admin/books/sample-id", { price: 1 }],
    ["DELETE", "/api/v1/admin/books/sample-id"],
    ["GET", "/api/v1/admin/coupons"],
    ["POST", "/api/v1/admin/coupons", {
      code: "SALES30",
      label: "Unauthorized",
      rate: 0.3,
      minSubtotal: 0,
      maxUses: 50,
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      enabled: true,
    }],
    ["PUT", "/api/v1/admin/coupons/SALES30", { enabled: true }],
    ["GET", "/api/v1/admin/categories"],
    ["POST", "/api/v1/admin/categories", { name: "Rogue Cat" }],
    ["GET", "/api/v1/admin/authors"],
    ["POST", "/api/v1/admin/authors", { name: "Rogue Author" }],
    ["GET", "/api/v1/admin/publishers"],
    ["POST", "/api/v1/admin/publishers", { name: "Rogue Pub" }],
    ["POST", "/api/v1/admin/uploads/book-cover", {}],
    ["GET", "/api/v1/admin/users"],
    ["PATCH", `/api/v1/admin/users/${customer.user.id}`, { studentVerificationStatus: "verified" }],
    ["GET", "/api/v1/admin/staff"],
    ["POST", "/api/v1/admin/staff", { name: "Rogue Staff", email: "rogue-sales@booknest.vn", password: "password12345", role: "support" }],
    ["PATCH", `/api/v1/admin/staff/${salesStaff.id}`, { role: "admin" }],
    ["GET", "/api/v1/admin/audit"],
    ["GET", "/api/v1/admin/privacy/data-requests"],
    ["PATCH", `/api/v1/admin/privacy/data-requests/${sampleId}`, { status: "completed" }],
    ["PATCH", "/api/v1/auth/customer-info", { role: "admin" }],
    ["PATCH", `/api/v1/users/${salesUser.id}`, { role: "admin" }],
  ]) {
    const res = await callAsSales(method, endpoint, body);
    assert.equal(res.status, 403, `Sales must get 403 on ${method} ${endpoint}`);
  }

  // --- D. DENIED: Accessing or mutating another user's personal resources (orders, profile, address, privacy export) ---
  const salesOwnOrders = await callAsSales("GET", "/api/v1/orders");
  assert.equal(salesOwnOrders.status, 200);
  assert.deepEqual(await salesOwnOrders.json(), []);

  for (const [method, endpoint, body] of [
    ["GET", `/api/v1/orders/${customerOrder.orderId}`],
    ["GET", `/api/v1/orders/${customerOrder.orderId}/status`],
    ["PATCH", `/api/v1/orders/${customerOrder.orderId}`, { status: "cancelled" }],
    ["PUT", `/api/v1/orders/${customerOrder.orderId}`, { status: "cancelled" }],
    ["DELETE", `/api/v1/orders/${customerOrder.orderId}`],
    ["GET", `/api/v1/users/${customer.user.id}`],
    ["PATCH", `/api/v1/users/${customer.user.id}`, { customerName: "Tampered" }],
    ["PUT", `/api/v1/users/${customer.user.id}`, { customerName: "Tampered" }],
    ["DELETE", `/api/v1/users/${customer.user.id}`],
    ["GET", `/api/v1/addresses/${customerAddress.id}`],
    ["PATCH", `/api/v1/addresses/${customerAddress.id}`, { label: "Tampered" }],
    ["PUT", `/api/v1/addresses/${customerAddress.id}`, { recipientName: "Tampered", phone: "0900000000", addressLine: "Tampered 12345" }],
    ["DELETE", `/api/v1/addresses/${customerAddress.id}`],
  ]) {
    const res = await callAsSales(method, endpoint, body);
    assert.equal(res.status, 403, `Sales must get 403 on ${method} ${endpoint}`);
    assert.doesNotMatch(await res.text(), /33 Đường Riêng Tư Sales|0906222333|khachhang-sales@example\.com/);
  }

  const stealExport = await fetch(
    `${baseUrl}/api/v1/privacy/exports/${customerExport.id}/download`,
    {
      headers: {
        Authorization: `Bearer ${salesToken}`,
        "X-Export-Token": customerExport.downloadToken,
      },
    },
  );
  assert.equal(stealExport.status, 403);

  // --- E. Confirm Sales role, order paymentStatus, and customer personal data remain intact ---
  const meSales = await (await callAsSales("GET", "/api/v1/auth/me")).json();
  assert.equal(meSales.user.role, "sales");

  const checkOrder = await (await fetch(`${baseUrl}/api/v1/orders/${customerOrder.orderId}/status`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(checkOrder.orderStatus, "processing");
  assert.equal(checkOrder.paymentStatus, "pending");

  const checkProfile = await (await fetch(`${baseUrl}/api/v1/users/${customer.user.id}`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(checkProfile.user.customerInfo.customerName, "Khách Hàng Sales Private");

  const checkAddr = await (await fetch(`${baseUrl}/api/v1/addresses/${customerAddress.id}`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(checkAddr.address.label, "Nhà Sales Cust");
});
