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
  process.env.ADMIN_PASSWORD = "user-perm-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-user-perms-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    addressesPath: path.join(directory, "addresses.json"),
    customersPath: path.join(directory, "customers.json"),
    customerInteractionsPath: path.join(directory, "customer-interactions.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
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

test("two-account cross-resource ownership on orders, profile, addresses, and personal privacy data", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  const userPassword = "two-account-user-pass-123";
  const registerUser = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: userPassword }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await registerUser("User Alpha", "alpha@example.com");
  const userB = await registerUser("User Beta", "beta@example.com");
  assert.equal(userA.user.role, "user");
  assert.equal(userB.user.role, "user");

  // --- Seed User B's resources: profile, address, order, consent, DSAR, privacy export ---
  const profileB = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      customerName: "Beta Private Name",
      phone: "0907333444",
      address: "100 Đường Riêng Tư Beta, Quận 3",
    }),
  });
  assert.equal(profileB.status, 200);

  const addrBRes = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      recipientName: "Beta Recipient",
      phone: "0907333444",
      addressLine: "100 Đường Riêng Tư Beta, Quận 3",
      city: "TP.HCM",
      label: "Nhà Beta",
    }),
  });
  assert.equal(addrBRes.status, 201);
  const { address: addressB } = await addrBRes.json();

  const orderBRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      customerName: "Beta Private Name",
      address: addressB.addressLine,
      addressId: addressB.id,
      phone: addressB.phone,
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(orderBRes.status, 201);
  const orderB = await orderBRes.json();

  const consentBRes = await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      purpose: "marketing",
      policyVersion: "2026-11",
      dataSource: "web",
      consent: true,
      retentionDays: 365,
    }),
  });
  assert.equal(consentBRes.status, 201);

  const dsarBRes = await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({ type: "export", channel: "web_portal" }),
  });
  assert.equal(dsarBRes.status, 201);
  const { request: dsarB } = await dsarBRes.json();

  const exportBRes = await fetch(`${baseUrl}/api/v1/privacy/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({ format: "json", currentPassword: userPassword }),
  });
  assert.equal(exportBRes.status, 201);
  const { export: exportB } = await exportBRes.json();
  assert.ok(exportB.id && exportB.downloadToken);

  // --- 1. Cross-account READ / UPDATE / DELETE on Orders ---
  for (const [method, endpoint, body] of [
    ["GET", `/api/v1/orders/${orderB.orderId}`],
    ["GET", `/api/v1/orders/${orderB.orderId}/status`],
    ["PATCH", `/api/v1/orders/${orderB.orderId}`, { status: "cancelled" }],
    ["PUT", `/api/v1/orders/${orderB.orderId}`, { status: "cancelled" }],
    ["DELETE", `/api/v1/orders/${orderB.orderId}`],
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${userA.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `User A must get 403 on ${method} ${endpoint}`);
  }

  // --- 2. Cross-account READ / UPDATE / DELETE on Profile ---
  for (const [method, endpoint, body] of [
    ["GET", `/api/v1/users/${userB.user.id}`],
    ["PATCH", `/api/v1/users/${userB.user.id}`, { customerName: "Hacked Beta" }],
    ["PUT", `/api/v1/users/${userB.user.id}`, { customerName: "Hacked Beta" }],
    ["DELETE", `/api/v1/users/${userB.user.id}`],
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${userA.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `User A must get 403 on ${method} ${endpoint}`);
  }

  // --- 3. Cross-account READ / UPDATE / DELETE on Addresses ---
  for (const [method, endpoint, body] of [
    ["GET", `/api/v1/addresses/${addressB.id}`],
    ["PATCH", `/api/v1/addresses/${addressB.id}`, { label: "Stolen" }],
    ["PUT", `/api/v1/addresses/${addressB.id}`, { recipientName: "Stolen", phone: "0901112223", addressLine: "Stolen Address 999" }],
    ["DELETE", `/api/v1/addresses/${addressB.id}`],
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${userA.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `User A must get 403 on ${method} ${endpoint}`);
  }

  // User A cannot attach User B's addressId to a new order
  const crossAddressOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      customerName: "User Alpha",
      address: "10 Đường Alpha, Quận 1",
      addressId: addressB.id,
      phone: "0901234567",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(crossAddressOrder.status, 403);

  // --- 4. Cross-account Personal Privacy Data Isolation ---
  // User A sees none of User B's consents, DSARs, or exports
  const consentsA = await (await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  })).json();
  assert.deepEqual(consentsA.records, []);

  const dsarsA = await (await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  })).json();
  assert.deepEqual(dsarsA.requests, []);

  const exportsA = await (await fetch(`${baseUrl}/api/v1/privacy/exports`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  })).json();
  assert.deepEqual(exportsA.exports, []);

  // Query param probing (?userId=userB.id) rejected with 400 on personal data endpoints
  for (const [method, endpoint] of [
    ["GET", `/api/v1/auth/me?userId=${userB.user.id}`],
    ["GET", `/api/v1/orders?userId=${userB.user.id}`],
    ["GET", `/api/v1/addresses?userId=${userB.user.id}`],
    ["GET", `/api/v1/privacy/consents?userId=${userB.user.id}`],
    ["GET", `/api/v1/privacy/data-requests?userId=${userB.user.id}`],
    ["GET", `/api/v1/privacy/exports?userId=${userB.user.id}`],
    ["DELETE", `/api/v1/privacy/consents/marketing?policyVersion=2026-11&userId=${userB.user.id}`],
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    assert.equal(res.status, 400, `User A must get 400 when probing ${method} ${endpoint}`);
  }

  // User A cannot download User B's privacy export even with User B's downloadToken
  const crossExportDownload = await fetch(
    `${baseUrl}/api/v1/privacy/exports/${exportB.id}/download`,
    {
      headers: {
        Authorization: `Bearer ${userA.token}`,
        "X-Export-Token": exportB.downloadToken,
      },
    },
  );
  assert.equal(crossExportDownload.status, 403);
  assert.doesNotMatch(await crossExportDownload.text(), /beta@example\.com|0907333444/);

  // User A revoking their own marketing consent does NOT affect User B's consent
  const revokeA = await fetch(
    `${baseUrl}/api/v1/privacy/consents/marketing?policyVersion=2026-11`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userA.token}` },
    },
  );
  assert.equal(revokeA.status, 200);

  // Verify User B's data is completely intact
  const checkConsentB = await (await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })).json();
  assert.equal(checkConsentB.current.marketing.consent, true);

  const checkDsarB = await (await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })).json();
  assert.equal(checkDsarB.requests.length, 1);
  assert.equal(checkDsarB.requests[0].id, dsarB.id);

  const checkOrderB = await (await fetch(`${baseUrl}/api/v1/orders/${orderB.orderId}/status`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })).json();
  assert.equal(checkOrderB.orderStatus, "received");

  const checkAddrB = await (await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })).json();
  assert.equal(checkAddrB.address.label, "Nhà Beta");

  const checkProfileB = await (await fetch(`${baseUrl}/api/v1/users/${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })).json();
  assert.equal(checkProfileB.user.customerInfo.customerName, "Beta Private Name");
});

test("User is blocked from all admin endpoints and cannot escalate role or tamper ownership", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  // 1. Registration rejects role/privilege injection
  for (const extra of [
    { role: "admin" },
    { role: "sales", isActive: true, studentVerification: { status: "verified" } },
  ]) {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Privilege Seeker",
        email: `escalate-${Object.keys(extra)[0]}@example.com`,
        password: "user-pass-123456",
        ...extra,
      }),
    });
    assert.equal(res.status, 400, `Register must reject ${JSON.stringify(extra)}`);
  }

  const registerUser = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: "user-pass-123456" }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await registerUser("Normal User A", "normal-a@example.com");
  const userB = await registerUser("Normal User B", "normal-b@example.com");

  // Create User A's own address and order to test ownership/field tampering
  const ownAddrRes = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      recipientName: "Normal User A",
      phone: "0901112233",
      addressLine: "15 Đường Alpha, Quận 1",
    }),
  });
  assert.equal(ownAddrRes.status, 201);
  const { address: ownAddr } = await ownAddrRes.json();

  const ownOrderRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      customerName: "Normal User A",
      address: "15 Đường Alpha, Quận 1",
      addressId: ownAddr.id,
      phone: "0901112233",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(ownOrderRes.status, 201);
  const ownOrder = await ownOrderRes.json();

  // 2. User cannot change role, account status, verification, or ownership on profile endpoints
  for (const endpoint of ["/api/v1/auth/customer-info", `/api/v1/users/${userA.user.id}`]) {
    for (const payload of [
      { role: "admin" },
      { isActive: false },
      { studentVerification: { status: "verified" } },
      { userId: userB.user.id, customerName: "Hijack" },
      { id: userB.user.id, customerName: "Hijack" },
    ]) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 403, `${endpoint} must reject ${JSON.stringify(payload)} with 403`);
    }
  }

  // 3. User cannot spoof ownership or privileged fields on addresses, orders, or privacy endpoints
  const spoofAddrCreate = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      userId: userB.user.id,
      recipientName: "Spoof",
      phone: "0901112233",
      addressLine: "15 Đường Spoof, Quận 1",
    }),
  });
  assert.equal(spoofAddrCreate.status, 400);

  const spoofAddrTransfer = await fetch(`${baseUrl}/api/v1/addresses/${ownAddr.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ userId: userB.user.id }),
  });
  assert.equal(spoofAddrTransfer.status, 400);

  const spoofOrderCreate = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      userId: userB.user.id,
      customerName: "Spoof",
      address: "15 Đường Spoof, Quận 1",
      phone: "0901112233",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(spoofOrderCreate.status, 400);

  const spoofOrderOwner = await fetch(`${baseUrl}/api/v1/orders/${ownOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ userId: userB.user.id }),
  });
  assert.equal(spoofOrderOwner.status, 400);

  const spoofOrderPayment = await fetch(`${baseUrl}/api/v1/orders/${ownOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ paymentStatus: "paid" }),
  });
  assert.equal(spoofOrderPayment.status, 403);

  const spoofOrderStatus = await fetch(`${baseUrl}/api/v1/orders/${ownOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ status: "completed" }),
  });
  assert.equal(spoofOrderStatus.status, 403);

  const spoofConsent = await fetch(`${baseUrl}/api/v1/privacy/consents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      userId: userB.user.id,
      purpose: "marketing",
      policyVersion: "2026-11",
      consent: true,
      retentionDays: 365,
    }),
  });
  assert.equal(spoofConsent.status, 400);

  const spoofDsar = await fetch(`${baseUrl}/api/v1/privacy/data-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ subjectId: userB.user.id, type: "delete" }),
  });
  assert.equal(spoofDsar.status, 400);

  // 4. User is blocked (403) from calling every admin & CRM management endpoint
  const sampleId = "00000000-0000-4000-8000-000000000001";
  const adminEndpoints = [
    ["GET", "/api/v1/admin/stats"],
    ["GET", "/api/v1/admin/monitoring"],
    ["GET", "/api/v1/admin/orders"],
    ["PATCH", `/api/v1/admin/orders/${ownOrder.orderId}`, { status: "completed", paymentStatus: "paid" }],
    ["GET", "/api/v1/admin/services"],
    ["GET", "/api/v1/admin/books"],
    ["POST", "/api/v1/admin/books", { title: "Rogue Book", price: 10000 }],
    ["GET", "/api/v1/admin/coupons"],
    ["GET", "/api/v1/admin/users"],
    ["PATCH", `/api/v1/admin/users/${userA.user.id}`, { studentVerificationStatus: "verified" }],
    ["GET", "/api/v1/admin/staff"],
    ["POST", "/api/v1/admin/staff", { name: "Rogue", email: "rogue@booknest.vn", password: "password12345", role: "sales" }],
    ["GET", "/api/v1/admin/audit"],
    ["GET", "/api/v1/admin/privacy/data-requests"],
    ["PATCH", `/api/v1/admin/privacy/data-requests/${sampleId}`, { status: "completed" }],
    ["GET", "/api/v1/customers"],
    ["GET", "/api/v1/admin/customers"],
    ["POST", "/api/v1/admin/customers", { name: "Fake", email: "fake@example.com", phone: "0901234567" }],
  ];

  for (const [method, endpoint, body] of adminEndpoints) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${userA.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `User must get 403 on ${method} ${endpoint}`);
  }

  // 5. Confirm User A's role is still "user" and legitimate self-service actions still work
  const meA = await (await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  })).json();
  assert.equal(meA.user.role, "user");

  const cancelOwn = await fetch(`${baseUrl}/api/v1/orders/${ownOrder.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelOwn.status, 200);
  assert.equal((await cancelOwn.json()).status, "cancelled");
});
