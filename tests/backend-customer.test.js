const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");
const { createServer } = require("../server");

test("staff management enforces admin access, role limits, and session revocation", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-staff-management-test-"),
  );
  const paths = {
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
  };
  const server = createServer(paths);
  const db = new Database(paths);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test("authenticated users can record, inspect, and withdraw privacy consent", async (t) => {
    const temporaryDirectory = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "booknest-consent-test-"),
    );
    const paths = {
      ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
      usersPath: path.join(temporaryDirectory, "users.json"),
      consentRecordsPath: path.join(temporaryDirectory, "consent-records.json"),
    };
    const database = new Database(paths);
    const user = await database.createUser({
      name: "Consent Demo",
      email: "consent-demo@example.com",
      password: "consent-test-password",
      role: "user",
    });
    const otherUser = await database.createUser({
      name: "Other Consent Demo",
      email: "other-consent-demo@example.com",
      password: "consent-test-password",
      role: "user",
    });
    const server = createServer({ ...paths, database });
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "consent-test-password" }),
    });
    const login = await loginResponse.json();
    const headers = {
      Authorization: `Bearer ${login.token}`,
      "Content-Type": "application/json",
    };

    const unauthenticatedResponse = await fetch(`${baseUrl}/api/privacy/consents`);
    assert.equal(unauthenticatedResponse.status, 401);

    const forgedOwnerResponse = await fetch(`${baseUrl}/api/privacy/consents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        purpose: "marketing",
        consent: true,
        policyVersion: "2026-01",
        retentionDays: 180,
        subjectId: otherUser.id,
      }),
    });
    assert.equal(forgedOwnerResponse.status, 400);

    const recordResponse = await fetch(`${baseUrl}/api/privacy/consents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        purpose: "marketing",
        consent: true,
        policyVersion: "2026-01",
        dataSource: "web",
        retentionDays: 180,
      }),
    });
    assert.equal(recordResponse.status, 201);
    assert.equal((await recordResponse.json()).record.consent, true);

    const revokeResponse = await fetch(
      `${baseUrl}/api/privacy/consents/marketing?policyVersion=2026-01`,
      { method: "DELETE", headers },
    );
    assert.equal(revokeResponse.status, 200);
    assert.equal((await revokeResponse.json()).record.consent, false);

    const listResponse = await fetch(`${baseUrl}/api/privacy/consents`, {
      headers,
    });
    const listed = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listed.current.marketing.consent, false);
    assert.equal(listed.records.length, 2);

    const otherLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: otherUser.email, password: "consent-test-password" }),
    });
    const otherLogin = await otherLoginResponse.json();
    const otherConsentResponse = await fetch(`${baseUrl}/api/privacy/consents`, {
      headers: { Authorization: `Bearer ${otherLogin.token}` },
    });
    assert.equal(otherConsentResponse.status, 200);
    assert.deepEqual((await otherConsentResponse.json()).records, []);
  });

  test("data-subject requests are private, validated, and transition with admin audit metadata", async (t) => {
    const temporaryDirectory = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "booknest-data-request-test-"),
    );
    const paths = {
      ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
      usersPath: path.join(temporaryDirectory, "users.json"),
      privacyDataRequestsPath: path.join(temporaryDirectory, "privacy-data-requests.json"),
    };
    const database = new Database(paths);
    const user = await database.createUser({
      name: "Request Owner",
      email: "request-owner@example.com",
      password: "request-test-password",
      role: "user",
    });
    const otherUser = await database.createUser({
      name: "Other Request Owner",
      email: "other-request-owner@example.com",
      password: "request-test-password",
      role: "user",
    });
    const admin = await database.createUser({
      name: "Privacy Admin",
      email: "privacy-admin@example.com",
      password: "request-test-password",
      role: "admin",
    });
    const server = createServer({ ...paths, database });
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    async function login(email) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "request-test-password" }),
      });
      return response.json();
    }
    const userLogin = await login(user.email);
    const otherLogin = await login(otherUser.email);
    const adminLogin = await login(admin.email);
    const userHeaders = {
      Authorization: `Bearer ${userLogin.token}`,
      "Content-Type": "application/json",
    };
    const adminHeaders = {
      Authorization: `Bearer ${adminLogin.token}`,
      "Content-Type": "application/json",
    };

    assert.equal((await fetch(`${baseUrl}/api/privacy/data-requests`)).status, 401);
    const invalidType = await fetch(`${baseUrl}/api/privacy/data-requests`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ type: "export-all" }),
    });
    assert.equal(invalidType.status, 400);
    const forgedOwner = await fetch(`${baseUrl}/api/privacy/data-requests`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ type: "delete", subjectId: otherUser.id }),
    });
    assert.equal(forgedOwner.status, 400);

    const createdResponse = await fetch(`${baseUrl}/api/privacy/data-requests`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ type: "access" }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).request;
    assert.equal(created.subjectId, user.id);
    assert.equal(created.status, "pending");
    assert.equal(created.createdBy, user.id);
    assert.equal("details" in created, false);

    const listedResponse = await fetch(`${baseUrl}/api/privacy/data-requests`, {
      headers: userHeaders,
    });
    assert.equal((await listedResponse.json()).requests.length, 1);
    const otherListedResponse = await fetch(`${baseUrl}/api/privacy/data-requests`, {
      headers: { Authorization: `Bearer ${otherLogin.token}` },
    });
    assert.deepEqual((await otherListedResponse.json()).requests, []);
    assert.equal((await fetch(`${baseUrl}/api/admin/privacy/data-requests`, {
      headers: userHeaders,
    })).status, 403);

    const processingResponse = await fetch(
      `${baseUrl}/api/admin/privacy/data-requests/${created.id}`,
      {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "processing" }),
      },
    );
    assert.equal(processingResponse.status, 200);
    const processing = (await processingResponse.json()).request;
    assert.equal(processing.updatedBy, admin.id);
    assert.equal(processing.status, "processing");

    const completedResponse = await fetch(
      `${baseUrl}/api/admin/privacy/data-requests/${created.id}`,
      {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "completed" }),
      },
    );
    assert.equal(completedResponse.status, 200);
    const completed = (await completedResponse.json()).request;
    assert.equal(completed.status, "completed");
    assert.ok(completed.resolvedAt);

    const invalidTransition = await fetch(
      `${baseUrl}/api/admin/privacy/data-requests/${created.id}`,
      {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "pending" }),
      },
    );
    assert.equal(invalidTransition.status, 409);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  await db.createUser({
    name: "Quản trị viên",
    email: "staff-admin@example.com",
    password: "admin-test-password",
    role: "admin",
  });
  await db.createUser({
    name: "Nhân viên sales",
    email: "staff-sales@example.com",
    password: "sales-test-password",
    role: "sales",
  });
  await db.createUser({
    name: "Nhân viên support",
    email: "staff-support@example.com",
    password: "support-test-password",
    role: "support",
  });
  await db.createUser({
    name: "Thành viên",
    email: "staff-member@example.com",
    password: "member-test-password",
    role: "user",
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function login(email, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return { response, data: await response.json() };
  }
  const { data: admin } = await login("staff-admin@example.com", "admin-test-password");
  const { data: sales } = await login("staff-sales@example.com", "sales-test-password");
  const { data: support } = await login("staff-support@example.com", "support-test-password");
  const { data: member } = await login("staff-member@example.com", "member-test-password");
  const adminHeaders = {
    Authorization: `Bearer ${admin.token}`,
    "Content-Type": "application/json",
  };

  const staffResponse = await fetch(`${baseUrl}/api/admin/staff`, {
    headers: adminHeaders,
  });
  assert.equal(staffResponse.status, 200);
  const staffData = await staffResponse.json();
  assert.ok(staffData.rolePermissions.sales.includes("read:orders"));
  assert.ok(staffData.rolePermissions.support.includes("read:customers"));
  assert.equal(JSON.stringify(staffData).includes("password"), false);

  for (const token of [sales.token, support.token, member.token]) {
    const deniedResponse = await fetch(`${baseUrl}/api/admin/staff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deniedResponse.status, 403);
    const deniedCreateResponse = await fetch(`${baseUrl}/api/admin/staff`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Không được phép",
        email: "denied-staff@example.com",
        password: "denied-staff-temporary-password",
        role: "sales",
      }),
    });
    assert.equal(deniedCreateResponse.status, 403);
  }

  const invalidRoleResponse = await fetch(`${baseUrl}/api/admin/staff`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Không được cấp admin",
      email: "elevated-staff@example.com",
      password: "staff-temporary-password",
      role: "admin",
    }),
  });
  assert.equal(invalidRoleResponse.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/admin/staff`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Nhân viên mới",
      email: "new-staff@example.com",
      password: "new-staff-temporary-password",
      role: "sales",
    }),
  });
  assert.equal(createResponse.status, 201);
  const createdStaff = await createResponse.json();
  assert.equal(createdStaff.role, "sales");
  assert.equal(createdStaff.isActive, true);
  assert.equal("password" in createdStaff, false);
  assert.equal("passwordReset" in createdStaff, false);

  const duplicateEmailResponse = await fetch(`${baseUrl}/api/admin/staff/${createdStaff.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ email: "staff-member@example.com" }),
  });
  assert.equal(duplicateEmailResponse.status, 409);

  const { response: staffLogin, data: staffSession } = await login(
    "new-staff@example.com",
    "new-staff-temporary-password",
  );
  assert.equal(staffLogin.status, 200);
  const updateResponse = await fetch(`${baseUrl}/api/admin/staff/${createdStaff.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Nhân viên đã cập nhật",
      email: "updated-staff@example.com",
      role: "support",
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updatedStaff = await updateResponse.json();
  assert.equal(updatedStaff.role, "support");
  assert.equal(updatedStaff.name, "Nhân viên đã cập nhật");
  assert.equal(updatedStaff.email, "updated-staff@example.com");

  const revokedSessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${staffSession.token}` },
  });
  assert.equal(revokedSessionResponse.status, 401);

  const { response: supportLogin, data: supportSession } = await login(
    "updated-staff@example.com",
    "new-staff-temporary-password",
  );
  assert.equal(supportLogin.status, 200);
  const disableResponse = await fetch(`${baseUrl}/api/admin/staff/${createdStaff.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(disableResponse.status, 200);
  assert.equal((await disableResponse.json()).isActive, false);

  const revokedSupportResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${supportSession.token}` },
  });
  assert.equal(revokedSupportResponse.status, 401);
  const { response: disabledLogin } = await login(
    "updated-staff@example.com",
    "new-staff-temporary-password",
  );
  assert.equal(disabledLogin.status, 401);
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

  const memberUnknownAdminPathRes = await fetch(`${baseUrl}/api/admin/secret`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert.equal(memberUnknownAdminPathRes.status, 403);

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

test("CRM API completes create, filter, status progression, and soft delete lifecycle", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-crm-lifecycle-test-"),
  );
  const paths = {
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    customersPath: path.join(temporaryDirectory, "customers.json"),
  };
  const server = createServer(paths);
  const db = new Database(paths);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  await db.createUser({
    name: "CRM Admin",
    email: "crm-admin@example.com",
    password: "password123",
    role: "admin",
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "crm-admin@example.com",
      password: "password123",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const token = (await loginResponse.json()).token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const createResponse = await fetch(`${baseUrl}/api/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "CRM Lifecycle",
      email: "crm-lifecycle@example.com",
      phone: "0912345678",
    }),
  });
  assert.equal(createResponse.status, 201);
  const customer = await createResponse.json();
  assert.equal(customer.status, "new");
  const admin = await db.findUserByEmail("crm-admin@example.com");
  assert.equal(customer.created_by, admin.id);

  const filteredResponse = await fetch(
    `${baseUrl}/api/customers?search=lifecycle&status=new&page=1&limit=1`,
    { headers },
  );
  assert.equal(filteredResponse.status, 200);
  assert.equal((await filteredResponse.json()).length, 1);

  const invalidTransitionResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "customer" }),
    },
  );
  assert.equal(invalidTransitionResponse.status, 409);

  const transitionResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "lead" }),
    },
  );
  assert.equal(transitionResponse.status, 200);
  assert.equal((await transitionResponse.json()).status, "lead");

  const deleteResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    { method: "DELETE", headers },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });

  const deletedLookupResponse = await fetch(
    `${baseUrl}/api/customers/${customer.id}`,
    { headers },
  );
  assert.equal(deletedLookupResponse.status, 404);
  const remainingResponse = await fetch(`${baseUrl}/api/customers`, { headers });
  assert.equal(remainingResponse.status, 200);
  assert.equal((await remainingResponse.json()).length, 0);
});

test("CRM customer interactions support paginated CRUD with role and audit checks", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-crm-interactions-test-"),
  );
  const paths = {
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    customersPath: path.join(temporaryDirectory, "customers.json"),
    customerInteractionsPath: path.join(temporaryDirectory, "customer-interactions.json"),
  };
  const db = new Database(paths);
  const adminUser = await db.createUser({
    name: "CRM Admin",
    email: "interactions-admin@example.com",
    password: "password123",
    role: "admin",
  });
  const supportUser = await db.createUser({
    name: "CRM Support",
    email: "interactions-support@example.com",
    password: "password123",
    role: "support",
  });
  const customer = await db.createCustomer({
    name: "Interaction Customer",
    email: "interactions-customer@example.com",
    phone: "0912345678",
  }, adminUser.id);
  const server = createServer(paths);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = async (email) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  const adminHeaders = {
    Authorization: `Bearer ${await login("interactions-admin@example.com")}`,
    "Content-Type": "application/json",
  };
  const supportHeaders = {
    Authorization: `Bearer ${await login("interactions-support@example.com")}`,
    "Content-Type": "application/json",
  };
  const collectionUrl = `${baseUrl}/api/admin/customers/${customer.id}/interactions`;

  const invalidType = await fetch(collectionUrl, {
    method: "POST",
    headers: supportHeaders,
    body: JSON.stringify({ type: "sms", note: "Not part of the CRM schema" }),
  });
  assert.equal(invalidType.status, 400);
  const oversizedNote = await fetch(collectionUrl, {
    method: "POST",
    headers: supportHeaders,
    body: JSON.stringify({ type: "call", note: "x".repeat(2001) }),
  });
  assert.equal(oversizedNote.status, 400);

  const firstCreate = await fetch(collectionUrl, {
    method: "POST",
    headers: supportHeaders,
    body: JSON.stringify({ type: "call", note: "Discussed book recommendations." }),
  });
  assert.equal(firstCreate.status, 201);
  const firstInteraction = await firstCreate.json();
  assert.equal(firstInteraction.created_by, supportUser.id);
  assert.equal(firstInteraction.updated_by, supportUser.id);
  assert.ok(firstInteraction.createdAt);
  assert.ok(firstInteraction.updatedAt);

  for (const [type, note] of [
    ["email", "Sent a reading list."],
    ["support", "Resolved a delivery question."],
  ]) {
    const response = await fetch(collectionUrl, {
      method: "POST",
      headers: supportHeaders,
      body: JSON.stringify({ type, note }),
    });
    assert.equal(response.status, 201);
  }

  const badPagination = await fetch(`${collectionUrl}?page=0`, {
    headers: supportHeaders,
  });
  assert.equal(badPagination.status, 400);
  const pagedResponse = await fetch(`${collectionUrl}?page=1&limit=2`, {
    headers: supportHeaders,
  });
  assert.equal(pagedResponse.status, 200);
  const paged = await pagedResponse.json();
  assert.equal(paged.total, 3);
  assert.equal(paged.page, 1);
  assert.equal(paged.limit, 2);
  assert.equal(paged.items.length, 2);

  const interactionUrl = `${collectionUrl}/${firstInteraction.id}`;
  const deniedUpdate = await fetch(interactionUrl, {
    method: "PATCH",
    headers: supportHeaders,
    body: JSON.stringify({ note: "Changed by support." }),
  });
  assert.equal(deniedUpdate.status, 403);

  const updatedResponse = await fetch(interactionUrl, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ type: "feedback", note: "Updated after follow-up." }),
  });
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.type, "feedback");
  assert.equal(updated.note, "Updated after follow-up.");
  assert.equal(updated.created_by, supportUser.id);
  assert.equal(updated.updated_by, adminUser.id);
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(firstInteraction.updatedAt));

  const invalidUpdate = await fetch(interactionUrl, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ note: "   " }),
  });
  assert.equal(invalidUpdate.status, 400);

  const deniedDelete = await fetch(interactionUrl, {
    method: "DELETE",
    headers: supportHeaders,
  });
  assert.equal(deniedDelete.status, 403);
  const deletedResponse = await fetch(interactionUrl, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deletedResponse.status, 200);
  assert.deepEqual(await deletedResponse.json(), { success: true });
  const afterDelete = await (await fetch(collectionUrl, { headers: adminHeaders })).json();
  assert.equal(afterDelete.total, 2);
  const missingInteraction = await fetch(
    `${collectionUrl}/00000000-0000-4000-8000-000000000001`,
    { method: "DELETE", headers: adminHeaders },
  );
  assert.equal(missingInteraction.status, 404);
});
