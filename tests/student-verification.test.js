const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

test("student discounts require admin verification and stop after revocation", async (t) => {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "local-test-admin-password-123";
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-student-verification-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jsonHeaders = { "Content-Type": "application/json" };
  const orderPayload = {
    customerName: "Nguyễn Văn A",
    address: "12 Đường Sách, Quận 1",
    phone: "0901234567",
    paymentMethod: "cod",
    discountRate: 0.1,
    items: [{ title: "Nhà giả kim", quantity: 1 }],
  };

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: "Student Applicant",
      email: "student-applicant@example.com",
      password: "password12345",
      studentType: "student",
      studentId: "STUDENT-123",
    }),
  });
  assert.equal(registration.status, 201);
  const registrationBody = await registration.json();
  const userToken = registrationBody.token;
  assert.equal(registrationBody.user.studentVerification.status, "pending");

  const unverifiedOrder = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Bearer ${userToken}` },
    body: JSON.stringify(orderPayload),
  });
  assert.equal(unverifiedOrder.status, 201);
  assert.equal((await unverifiedOrder.json()).discount, 4450);

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "admin@example.com", password: "local-test-admin-password-123" }),
  });
  const adminToken = (await adminLogin.json()).token;
  const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const user = (await usersResponse.json()).find((entry) => entry.email === "student-applicant@example.com");
  assert.ok(user);

  const verified = await fetch(`${baseUrl}/api/admin/users/${user.id}`, {
    method: "PATCH",
    headers: { ...jsonHeaders, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ studentVerificationStatus: "verified" }),
  });
  assert.equal(verified.status, 200);
  const verifiedUser = await verified.json();
  assert.equal(verifiedUser.studentVerification.status, "verified");
  assert.ok(verifiedUser.studentVerification.verifiedAt);
  assert.equal(verifiedUser.studentVerification.verifiedBy, "admin-master");

  const loginAfterApproval = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "student-applicant@example.com", password: "password12345" }),
  });
  const verifiedToken = (await loginAfterApproval.json()).token;
  const verifiedOrder = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Bearer ${verifiedToken}` },
    body: JSON.stringify(orderPayload),
  });
  assert.equal(verifiedOrder.status, 201);
  assert.equal((await verifiedOrder.json()).discount, 8900);

  const revoked = await fetch(`${baseUrl}/api/admin/users/${user.id}`, {
    method: "PATCH",
    headers: { ...jsonHeaders, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ studentVerificationStatus: "revoked" }),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).studentVerification.status, "revoked");

  const loginAfterRevocation = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "student-applicant@example.com", password: "password12345" }),
  });
  const revokedToken = (await loginAfterRevocation.json()).token;
  const revokedOrder = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Bearer ${revokedToken}` },
    body: JSON.stringify(orderPayload),
  });
  assert.equal(revokedOrder.status, 201);
  assert.equal((await revokedOrder.json()).discount, 4450);
});
