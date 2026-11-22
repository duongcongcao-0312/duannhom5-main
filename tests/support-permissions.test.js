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
  process.env.ADMIN_PASSWORD = "support-perm-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-support-perms-"));
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

test("Support role is restricted to allowed support operations and blocked from out-of-scope pricing, roles, config, and other customers' data", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Login Admin and provision Support staff account
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "support-perm-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  const createSupport = await fetch(`${baseUrl}/api/v1/admin/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Support Agent",
      email: "support-agent@booknest.vn",
      password: "support-agent-pass-123",
      role: "support",
    }),
  });
  assert.equal(createSupport.status, 201);
  const supportStaff = await createSupport.json();

  const supportLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "support-agent@booknest.vn",
      password: "support-agent-pass-123",
    }),
  });
  assert.equal(supportLogin.status, 200);
  const { token: supportToken, user: supportUser } = await supportLogin.json();
  assert.equal(supportUser.role, "support");

  // 2. Seed customer account, address, order, privacy export, service request, CRM customer, and book/coupon
  const customerPass = "customer-secret-pass-123";
  const custReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Khách Hàng A",
      email: "khachhang-a@example.com",
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
      customerName: "Khách Hàng A Private",
      phone: "0905123456",
      address: "25 Đường Riêng Tư A, Quận 1",
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
      recipientName: "Khách Hàng A",
      phone: "0905123456",
      addressLine: "25 Đường Riêng Tư A, Quận 1",
      label: "Nhà A",
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
      customerName: "Khách Hàng A",
      address: customerAddress.addressLine,
      addressId: customerAddress.id,
      phone: customerAddress.phone,
      paymentMethod: "cod",
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
      name: "Khách Hàng A",
      phone: "0905123456",
      service: "rent",
      note: "Cần hỗ trợ thuê sách",
    }),
  });
  assert.equal(serviceRes.status, 201);
  const { request: serviceRequest } = await serviceRes.json();

  const crmCustomerRes = await fetch(`${baseUrl}/api/v1/admin/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "CRM Customer A",
      email: "crm-a@example.com",
      phone: "0905123456",
    }),
  });
  assert.equal(crmCustomerRes.status, 201);
  const crmCustomer = await crmCustomerRes.json();

  const callAsSupport = (method, endpoint, body) =>
    fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${supportToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // --- A. ALLOWED Support operations (per permission matrix) ---
  // 1. Read & update service requests
  const listServices = await callAsSupport("GET", "/api/v1/admin/services");
  assert.equal(listServices.status, 200);
  const servicesList = await listServices.json();
  assert.ok(servicesList.some((item) => item.id === serviceRequest.id));

  const updateService = await callAsSupport(
    "PATCH",
    `/api/v1/admin/services/${serviceRequest.id}`,
    { status: "processing" },
  );
  assert.equal(updateService.status, 200);
  assert.equal((await updateService.json()).status, "processing");

  // 2. Read CRM customer records and read/create CRM care interactions
  assert.equal((await callAsSupport("GET", "/api/v1/customers")).status, 200);
  assert.equal((await callAsSupport("GET", "/api/v1/admin/customers")).status, 200);
  assert.equal((await callAsSupport("GET", `/api/v1/customers/${crmCustomer.id}`)).status, 200);
  assert.equal((await callAsSupport("GET", `/api/v1/admin/customers/${crmCustomer.id}`)).status, 200);
  assert.equal((await callAsSupport("GET", `/api/v1/customers/${crmCustomer.id}/interactions`)).status, 200);

  const createInteraction = await callAsSupport(
    "POST",
    `/api/v1/admin/customers/${crmCustomer.id}/interactions`,
    { type: "call", note: "Đã liên hệ hỗ trợ khách hàng." },
  );
  assert.equal(createInteraction.status, 201);
  const interaction = await createInteraction.json();

  // --- B. DENIED: CRM mutations beyond Support scope ---
  for (const [method, endpoint, body] of [
    ["POST", "/api/v1/customers", { name: "New", email: "new-sup@example.com", phone: "0909888777" }],
    ["POST", "/api/v1/admin/customers", { name: "New", email: "new-sup2@example.com", phone: "0909888778" }],
    ["PATCH", `/api/v1/customers/${crmCustomer.id}`, { name: "Tampered" }],
    ["PUT", `/api/v1/admin/customers/${crmCustomer.id}`, { name: "Tampered" }],
    ["DELETE", `/api/v1/customers/${crmCustomer.id}`],
    ["DELETE", `/api/v1/admin/customers/${crmCustomer.id}`],
    ["PATCH", `/api/v1/customers/${crmCustomer.id}/interactions/${interaction.id}`, { note: "Edited" }],
    ["PUT", `/api/v1/admin/customers/${crmCustomer.id}/interactions/${interaction.id}`, { note: "Edited" }],
    ["DELETE", `/api/v1/customers/${crmCustomer.id}/interactions/${interaction.id}`],
    ["DELETE", `/api/v1/admin/customers/${crmCustomer.id}/interactions/${interaction.id}`],
  ]) {
    const res = await callAsSupport(method, endpoint, body);
    assert.equal(res.status, 403, `Support must get 403 on ${method} ${endpoint}`);
  }

  // --- C. DENIED: Pricing, catalog, coupons, dashboard, roles, staff, users, privacy admin, audit ---
  const sampleId = "00000000-0000-4000-8000-000000000001";
  for (const [method, endpoint, body] of [
    ["GET", "/api/v1/admin/stats"],
    ["GET", "/api/v1/admin/monitoring"],
    ["GET", "/api/v1/admin/orders"],
    ["PATCH", `/api/v1/admin/orders/${customerOrder.orderId}`, { status: "completed", paymentStatus: "paid" }],
    ["GET", "/api/v1/admin/books"],
    ["POST", "/api/v1/admin/books", { title: "Cheap Book", category: "van-hoc", price: 1, stock: 99 }],
    ["PATCH", "/api/v1/admin/books/sample-id", { price: 1 }],
    ["DELETE", "/api/v1/admin/books/sample-id"],
    ["GET", "/api/v1/admin/coupons"],
    ["POST", "/api/v1/admin/coupons", {
      code: "SUP30",
      label: "Unauthorized",
      rate: 0.3,
      minSubtotal: 0,
      maxUses: 100,
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      enabled: true,
    }],
    ["PUT", "/api/v1/admin/coupons/SUP30", { enabled: true }],
    ["GET", "/api/v1/admin/categories"],
    ["POST", "/api/v1/admin/categories", { name: "Rogue" }],
    ["GET", "/api/v1/admin/authors"],
    ["POST", "/api/v1/admin/authors", { name: "Rogue" }],
    ["GET", "/api/v1/admin/publishers"],
    ["POST", "/api/v1/admin/publishers", { name: "Rogue" }],
    ["POST", "/api/v1/admin/uploads/book-cover", {}],
    ["GET", "/api/v1/admin/users"],
    ["PATCH", `/api/v1/admin/users/${customer.user.id}`, { studentVerificationStatus: "verified" }],
    ["GET", "/api/v1/admin/staff"],
    ["POST", "/api/v1/admin/staff", { name: "Escalated", email: "esc@booknest.vn", password: "password12345", role: "sales" }],
    ["PATCH", `/api/v1/admin/staff/${supportStaff.id}`, { role: "admin" }],
    ["GET", "/api/v1/admin/audit"],
    ["GET", "/api/v1/admin/privacy/data-requests"],
    ["PATCH", `/api/v1/admin/privacy/data-requests/${sampleId}`, { status: "completed" }],
    ["PATCH", "/api/v1/auth/customer-info", { role: "admin" }],
    ["PATCH", `/api/v1/users/${supportUser.id}`, { role: "admin" }],
  ]) {
    const res = await callAsSupport(method, endpoint, body);
    assert.equal(res.status, 403, `Support must get 403 on ${method} ${endpoint}`);
  }

  // --- D. DENIED: Accessing or mutating another customer's order, profile, address, or privacy export ---
  const supportOwnOrders = await callAsSupport("GET", "/api/v1/orders");
  assert.equal(supportOwnOrders.status, 200);
  assert.deepEqual(await supportOwnOrders.json(), []);

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
    const res = await callAsSupport(method, endpoint, body);
    assert.equal(res.status, 403, `Support must get 403 on ${method} ${endpoint}`);
    assert.doesNotMatch(await res.text(), /25 Đường Riêng Tư A|0905123456|khachhang-a@example\.com/);
  }

  const stealExport = await fetch(
    `${baseUrl}/api/v1/privacy/exports/${customerExport.id}/download`,
    {
      headers: {
        Authorization: `Bearer ${supportToken}`,
        "X-Export-Token": customerExport.downloadToken,
      },
    },
  );
  assert.equal(stealExport.status, 403);

  // --- E. Confirm Support role and Customer data remain intact ---
  const meSupport = await (await callAsSupport("GET", "/api/v1/auth/me")).json();
  assert.equal(meSupport.user.role, "support");

  const intactOrder = await (await fetch(`${baseUrl}/api/v1/orders/${customerOrder.orderId}/status`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(intactOrder.orderStatus, "received");

  const intactProfile = await (await fetch(`${baseUrl}/api/v1/users/${customer.user.id}`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(intactProfile.user.customerInfo.customerName, "Khách Hàng A Private");

  const intactAddr = await (await fetch(`${baseUrl}/api/v1/addresses/${customerAddress.id}`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  assert.equal(intactAddr.address.label, "Nhà A");
});
