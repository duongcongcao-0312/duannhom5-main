"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_REFRESH_TTL_MS,
  SESSION_TTL_MS,
  SessionStore,
} = require("../backend/auth");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-exp-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    ...overrides,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("session lifecycle defaults define absolute TTL, idle timeout, and refresh ceiling", () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  assert.equal(SESSION_IDLE_TIMEOUT_MS, 2 * 60 * 60 * 1000);
  assert.equal(SESSION_REFRESH_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.throws(() => new SessionStore({ sessionTtlMs: 0, cleanupIntervalMs: 0 }), RangeError);
  assert.throws(() => new SessionStore({ idleTimeoutMs: -1, cleanupIntervalMs: 0 }), RangeError);
  assert.throws(() => new SessionStore({ refreshTtlMs: 0, cleanupIntervalMs: 0 }), RangeError);
});

test("server enforces absolute session expiry and allows clean re-login", async (t) => {
  const baseUrl = await withServer(t, {
    sessionTtlMs: 120,
    idleTimeoutMs: 5000,
    refreshTtlMs: 5000,
  });

  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Expiry User", email: "exp@example.com", password: "expiry-password-123" }),
  });
  assert.equal(reg.status, 201);
  const { token } = await reg.json();

  // Valid immediately
  const ok = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(ok.status, 200);

  // Wait past absolute sessionTtlMs
  await new Promise((resolve) => setTimeout(resolve, 160));
  const expired = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(expired.status, 401);

  const expiredRefresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(expiredRefresh.status, 401);

  // Re-login issues a fresh working session
  const relogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "exp@example.com", password: "expiry-password-123" }),
  });
  assert.equal(relogin.status, 200);
  const { token: freshToken } = await relogin.json();
  const freshMe = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(freshMe.status, 200);
});

test("server enforces sliding inactivity timeout and absolute refresh ceiling", async (t) => {
  const baseUrl = await withServer(t, {
    sessionTtlMs: 5000,
    idleTimeoutMs: 120,
    refreshTtlMs: 320,
  });

  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Idle User", email: "idle@example.com", password: "idle-password-123" }),
  });
  assert.equal(reg.status, 201);
  const { token } = await reg.json();

  // Activity within idleTimeoutMs (70ms < 120ms) keeps session alive past initial 120ms
  await new Promise((resolve) => setTimeout(resolve, 70));
  const active1 = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(active1.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 70));
  const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(refreshRes.status, 200);
  const refreshedBody = await refreshRes.json();
  assert.ok(Number.isFinite(refreshedBody.expiresAt));
  assert.ok(Number.isFinite(refreshedBody.idleExpiresAt));
  assert.ok(Number.isFinite(refreshedBody.refreshExpiresAt));

  // Going idle for >= idleTimeoutMs (150ms >= 120ms) expires the session even though sessionTtlMs is 5000ms
  await new Promise((resolve) => setTimeout(resolve, 150));
  const idleExpired = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(idleExpired.status, 401);
});

test("refreshSession extends expiresAt without extending the absolute refreshExpiresAt ceiling", async () => {
  const store = new SessionStore({
    sessionTtlMs: 500,
    idleTimeoutMs: 500,
    refreshTtlMs: 120,
    cleanupIntervalMs: 0,
  });
  const session = await store.createSession({ id: "u1", email: "cap@example.com", name: "Cap User" });
  const initialRefreshCap = session.refreshExpiresAt;

  await new Promise((resolve) => setTimeout(resolve, 30));
  const refreshed = await store.refreshSession(session.token, session.refreshToken);
  assert.ok(refreshed);
  assert.equal(refreshed.refreshExpiresAt, initialRefreshCap);
  assert.ok(refreshed.expiresAt > session.expiresAt);

  // After initialRefreshCap passes, refresh fails
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(await store.refreshSession(session.token, session.refreshToken), null);
  store.close();
});
