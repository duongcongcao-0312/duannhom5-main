const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");


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
