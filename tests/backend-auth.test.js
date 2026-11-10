const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { SessionStore } = require("../backend/auth");

test("shared session repositories preserve sessions across instances and revoke them everywhere", async () => {
  const records = new Map();
  const repository = {
    async saveSessionRecord(key, session) {
      records.set(key, structuredClone(session));
    },
    async getSessionRecord(key) {
      const session = records.get(key);
      return session ? structuredClone(session) : null;
    },
    async deleteSessionRecord(key) {
      return records.delete(key);
    },
    async deleteUserSessionRecords(userId) {
      let removed = 0;
      for (const [key, session] of records) {
        if (session.userId === userId) {
          records.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async pruneExpiredSessionRecords() {
      let removed = 0;
      for (const [key, session] of records) {
        if (session.expiresAt <= Date.now()) {
          records.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
  const firstInstance = new SessionStore({
    repository,
    sessionTtlMs: 1000,
    cleanupIntervalMs: 0,
  });
  const secondInstance = new SessionStore({
    repository,
    sessionTtlMs: 1000,
    cleanupIntervalMs: 0,
  });
  const session = await firstInstance.createSession({
    id: "shared-user",
    email: "shared@example.com",
    name: "Shared User",
  });

  assert.equal((await secondInstance.getSession(session.token)).userId, "shared-user");
  assert.equal(records.size, 1);
  assert.doesNotMatch(JSON.stringify([...records.values()]), new RegExp(session.token));

  await secondInstance.destroySession(session.token);
  assert.equal(await firstInstance.getSession(session.token), null);
  assert.equal(records.size, 0);

  const expiringSession = await firstInstance.createSession(
    { id: "expired-user", email: "expired@example.com", name: "Expired User" },
    1,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await secondInstance.getSession(expiringSession.token), null);
  assert.equal(records.size, 0);
  firstInstance.close();
  secondInstance.close();
});

async function startAuthTestServer(t, options = {}) {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-auth-session-test-"),
  );
  const server = createServer({
    ordersPath: path.join(temporaryDirectory, "orders.jsonl"),
    usersPath: path.join(temporaryDirectory, "users.json"),
    servicesPath: path.join(temporaryDirectory, "services.jsonl"),
    ...options,
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return `http://127.0.0.1:${server.address().port}`;
}

test("expired sessions are rejected by every protected endpoint", async (t) => {
  const baseUrl = await startAuthTestServer(t, { sessionTtlMs: 25 });
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Expired User",
      email: "expired@example.com",
      password: "password12345",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const { token } = await registerResponse.json();

  await new Promise((resolve) => setTimeout(resolve, 50));
  const headers = { Authorization: `Bearer ${token}` };
  const profileResponse = await fetch(`${baseUrl}/api/auth/me`, { headers });
  const customersResponse = await fetch(`${baseUrl}/api/customers`, { headers });
  assert.equal(profileResponse.status, 401);
  assert.equal(customersResponse.status, 401);
});

test("refresh tokens enforce their expiry and reject mismatched values", async () => {
  const store = new SessionStore({
    sessionTtlMs: 30_000,
    refreshTtlMs: 5,
    cleanupIntervalMs: 0,
  });
  const user = { id: "r1", email: "refresh@example.com", name: "Refresh User" };
  const session = await store.createSession(user);

  assert.equal(store.verifyRefreshToken("not-the-right-token", session), false);
  assert.equal(store.verifyRefreshToken(session.refreshToken, session), true);
  const refreshed = await store.refreshSession(session.token, session.refreshToken);
  assert.ok(refreshed);
  assert.ok(refreshed.expiresAt > Date.now());

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(await store.refreshSession(session.token, session.refreshToken), null);
  assert.equal(await store.getSession(session.token), null);
  store.close();
});

test("profile endpoint rejects missing and invalid bearer tokens", async (t) => {
  const baseUrl = await startAuthTestServer(t);
  const missingTokenResponse = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(missingTokenResponse.status, 401);

  const invalidTokenResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert.equal(invalidTokenResponse.status, 401);
  assert.deepEqual(await invalidTokenResponse.json(), await missingTokenResponse.json());
});

test("logging out revokes the token for subsequent protected requests", async (t) => {
  const baseUrl = await startAuthTestServer(t);
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Logged Out User",
      email: "logged-out@example.com",
      password: "password12345",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const { token } = await registerResponse.json();
  const headers = { Authorization: `Bearer ${token}` };

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers,
  });
  assert.equal(logoutResponse.status, 200);

  const profileResponse = await fetch(`${baseUrl}/api/auth/me`, { headers });
  const customersResponse = await fetch(`${baseUrl}/api/customers`, { headers });
  assert.equal(profileResponse.status, 401);
  assert.equal(customersResponse.status, 401);
});

test("login failures use a generic response and are limited per source address", async (t) => {
  const baseUrl = await startAuthTestServer(t);
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Login Limit User",
      email: "login-limit@example.com",
      password: "password12345",
    }),
  });
  assert.equal(registerResponse.status, 201);

  const login = (email, password) => fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const unknownUserResponse = await login("unknown@example.com", "password12345");
  assert.equal(unknownUserResponse.status, 401);
  const unknownUserError = await unknownUserResponse.json();

  const wrongPasswordResponse = await login("login-limit@example.com", "wrong-password");
  assert.equal(wrongPasswordResponse.status, 401);
  assert.deepEqual(await wrongPasswordResponse.json(), unknownUserError);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await login("login-limit@example.com", "wrong-password");
    assert.equal(response.status, 401);
  }
  const limitedResponse = await login("login-limit@example.com", "password12345");
  assert.equal(limitedResponse.status, 429);
  assert.match((await limitedResponse.json()).error, /thử lại sau 15 phút/i);

  const invalidTokenResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert.equal(invalidTokenResponse.status, 401);
  assert.match((await invalidTokenResponse.json()).error, /chưa đăng nhập/i);
});

test("successful login resets failed attempts for the source address", async (t) => {
  const baseUrl = await startAuthTestServer(t);
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Reset Attempts User",
      email: "reset-attempts@example.com",
      password: "password12345",
    }),
  });
  assert.equal(registerResponse.status, 201);

  const login = (password) => fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "reset-attempts@example.com", password }),
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await login("wrong-password");
    assert.equal(response.status, 401);
  }
  assert.equal((await login("password12345")).status, 200);
  assert.equal((await login("wrong-password")).status, 401);
});

test("registration enforces password length and counts repeated attempts per source address", async (t) => {
  const baseUrl = await startAuthTestServer(t);
  const register = (email, password) => fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Password Policy User", email, password }),
  });

  for (const [email, password] of [
    ["short@example.com", "12345678901"],
    ["spaces@example.com", "            "],
    ["long@example.com", "x".repeat(129)],
  ]) {
    const response = await register(email, password);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /12 đến 128/i);
  }

  const boundaryPassword = " 1234567890 ";
  const accepted = await register("boundary@example.com", boundaryPassword);
  assert.equal(accepted.status, 201);
  const boundaryLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "boundary@example.com", password: boundaryPassword }),
  });
  assert.equal(boundaryLogin.status, 200);

  const limitedBaseUrl = await startAuthTestServer(t);
  const rejectedRegistration = () => fetch(`${limitedBaseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Rate Limit User",
      email: "retry@example.com",
      password: "12345678901",
    }),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await rejectedRegistration()).status, 400);
  }
  const rateLimited = await rejectedRegistration();
  assert.equal(rateLimited.status, 429);
  assert.match((await rateLimited.json()).error, /quá nhiều lần/i);
});

test("password reset requests are rate limited by source address and email", async (t) => {
  const baseUrl = await startAuthTestServer(t, {
    appBaseUrl: "https://shop.example/",
    passwordResetMailer: { async sendPasswordReset() {} },
  });
  const requestReset = () => fetch(`${baseUrl}/api/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "limited-reset@example.com" }),
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await requestReset()).status, 200);
  }
  const limitedResponse = await requestReset();
  assert.equal(limitedResponse.status, 429);
  assert.match((await limitedResponse.json()).error, /quá nhiều lần/i);
});

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
  const invalidPasswordRes = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "short-pass" }),
  });
  assert.equal(invalidPasswordRes.status, 400);

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
  await assert.rejects(
    fsPromises.access(path.join(temporaryDirectory, "users.json")),
    { code: "ENOENT" },
  );
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
    password: "password12345",
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
