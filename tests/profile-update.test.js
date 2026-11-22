const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  diffCustomerInfo,
  findPhoneConflict,
  parseProfileUpdate,
  requiresConfirmation,
} = require("../backend/profile-update");

test("profile update policy validates self-service fields and rejects verified fields", () => {
  assert.deepEqual(
    parseProfileUpdate({ phone: " 0901 234 567 ", address: "12 Lê Lợi, Quận 1, TP.HCM" }).changes,
    { phone: "0901 234 567", address: "12 Lê Lợi, Quận 1, TP.HCM" },
  );
  for (const field of ["email", "studentId", "studentType", "role", "password", "userId"]) {
    assert.throws(
      () => parseProfileUpdate({ [field]: "x", phone: "0901234567" }),
      (error) => error.status === 403 && error.errorCode === "VERIFICATION_REQUIRED",
    );
  }
  assert.throws(() => parseProfileUpdate({ phone: "abc" }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ phone: "1234" }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ address: "ngắn" }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ name: "A" }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ address: "x".repeat(301) }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ phone: 123456789 }), { status: 400 });
  assert.throws(() => parseProfileUpdate({ unknown: "x" }), { status: 400 });
  assert.throws(() => parseProfileUpdate({}), { status: 400 });
  assert.throws(() => parseProfileUpdate(null), { status: 400 });
});

test("profile update policy detects no-op changes, confirmation needs and duplicates", () => {
  const stored = { phone: "0901234567", address: "12 Lê Lợi, Quận 1" };
  assert.deepEqual(diffCustomerInfo(stored, { phone: "0901 234 567" }), {});
  assert.deepEqual(diffCustomerInfo(stored, { phone: "0907654321" }), { phone: "0907654321" });
  assert.equal(requiresConfirmation(stored, { phone: "0907654321" }), true);
  assert.equal(requiresConfirmation({}, { phone: "0907654321" }), false);
  assert.equal(requiresConfirmation(stored, { address: "34 Hai Bà Trưng, Q1" }), false);
  const users = [
    { id: "a", customerInfo: { phone: "0901 234 567" } },
    { id: "b", isActive: false, customerInfo: { phone: "0911111111" } },
  ];
  assert.equal(findPhoneConflict(users, "me", "0901234567"), true);
  assert.equal(findPhoneConflict(users, "a", "0901234567"), false);
  assert.equal(findPhoneConflict(users, "me", "0911111111"), false);
});

test("customer-info endpoint enforces ownership, confirmation, duplicates and minimal audit", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-profile-update-test-"),
  );
  const auditLogPath = path.join(temporaryDirectory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    auditLogPath,
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

  async function register(email) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Reader", email, password: "password12345" }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).token;
  }
  function patch(token, body) {
    return fetch(`${baseUrl}/api/auth/customer-info`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  const ownerToken = await register("owner@example.com");
  const otherToken = await register("other@example.com");

  const unauthenticated = await fetch(`${baseUrl}/api/auth/customer-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "0901234567" }),
  });
  assert.equal(unauthenticated.status, 401);

  const crossAccount = await patch(ownerToken, { userId: "someone-else", phone: "0901234567" });
  assert.equal(crossAccount.status, 403);

  const emailChange = await patch(ownerToken, { email: "new@example.com" });
  assert.equal(emailChange.status, 403);
  assert.equal((await emailChange.json()).code, "VERIFICATION_REQUIRED");

  const invalidPhone = await patch(ownerToken, { phone: "not-a-phone" });
  assert.equal(invalidPhone.status, 400);

  const firstSet = await patch(ownerToken, {
    phone: "0901234567",
    address: "12 Lê Lợi, Quận 1, TP.HCM",
  });
  assert.equal(firstSet.status, 200);
  const firstBody = await firstSet.json();
  assert.deepEqual(firstBody.changedFields.sort(), ["address", "phone"]);
  assert.equal(firstBody.ordersUpdated, 0);

  const duplicateSubmit = await patch(ownerToken, { phone: "0901 234 567" });
  assert.equal(duplicateSubmit.status, 200);
  assert.deepEqual((await duplicateSubmit.json()).changedFields, []);

  const phoneTaken = await patch(otherToken, { phone: "0901234567" });
  assert.equal(phoneTaken.status, 409);
  assert.equal((await phoneTaken.json()).code, "PHONE_IN_USE");

  const unconfirmed = await patch(ownerToken, { phone: "0907654321" });
  assert.equal(unconfirmed.status, 428);
  assert.equal((await unconfirmed.json()).code, "REAUTH_REQUIRED");

  const wrongPassword = await patch(ownerToken, { phone: "0907654321", currentPassword: "wrong-password" });
  assert.equal(wrongPassword.status, 401);

  const confirmed = await patch(ownerToken, { phone: "0907654321", currentPassword: "password12345" });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).customerInfo.phone, "0907654321");

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal((await me.json()).user.customerInfo.phone, "0907654321");

  const auditText = await fsPromises.readFile(auditLogPath, "utf8");
  const profileEvents = auditText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.action === "user.customer_info.update");
  assert.equal(profileEvents.length, 2);
  assert.equal(profileEvents[1].metadata.confirmation, "password");
  assert.doesNotMatch(auditText, /0907654321|0901234567|Lê Lợi|password12345/);
});
