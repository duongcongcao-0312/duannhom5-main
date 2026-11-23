"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-csrf-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    corsOrigins: "https://store.booknest.example,http://localhost:8000",
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

test("state-changing API requests reject untrusted Origin, Referer, and Sec-Fetch-Site while allowing same-origin and configured origins", async (t) => {
  const baseUrl = await withServer(t);

  // Same-origin POST succeeds
  const sameOriginReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({
      name: "Same Origin User",
      email: "same-origin@example.com",
      password: "csrf-test-password-123",
    }),
  });
  assert.equal(sameOriginReg.status, 201);
  const { token } = await sameOriginReg.json();

  // Configured allowed CORS origin POST succeeds
  const allowedOriginReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://store.booknest.example",
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({
      name: "Allowed Origin User",
      email: "allowed@example.com",
      password: "csrf-test-password-123",
    }),
  });
  assert.equal(allowedOriginReg.status, 201);

  // Untrusted Origin on state-changing authenticated route -> 403 CSRF_ORIGIN_FORBIDDEN
  const evilOrigin = await fetch(`${baseUrl}/api/v1/auth/customer-info`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ name: "Hijacked" }),
  });
  assert.equal(evilOrigin.status, 403);
  assert.equal((await evilOrigin.json()).code, "CSRF_ORIGIN_FORBIDDEN");

  // Origin: null (sandboxed iframe / redirect) -> 403 CSRF_ORIGIN_FORBIDDEN
  const nullOrigin = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "null",
    },
  });
  assert.equal(nullOrigin.status, 403);
  assert.equal((await nullOrigin.json()).code, "CSRF_ORIGIN_FORBIDDEN");

  // Untrusted Referer without Origin -> 403 CSRF_ORIGIN_FORBIDDEN
  const evilReferer = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Referer: "https://attacker.example/csrf-form.html",
    },
  });
  assert.equal(evilReferer.status, 403);
  assert.equal((await evilReferer.json()).code, "CSRF_ORIGIN_FORBIDDEN");

  // Cross-site Sec-Fetch-Site without allowed Origin -> 403 CSRF_CROSS_SITE_FORBIDDEN
  const crossSiteNoOrigin = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Sec-Fetch-Site": "cross-site",
    },
  });
  assert.equal(crossSiteNoOrigin.status, 403);
  assert.equal((await crossSiteNoOrigin.json()).code, "CSRF_CROSS_SITE_FORBIDDEN");

  // Safe GET request from another origin is not blocked by CSRF check
  const safeGet = await fetch(`${baseUrl}/api/v1/books`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(safeGet.status, 200);
});

test("cookie-bearing state-changing requests enforce double-submit CSRF token validation", async (t) => {
  const baseUrl = await withServer(t);

  // Issue CSRF token + cookie
  const csrfRes = await fetch(`${baseUrl}/api/v1/auth/csrf-token`);
  assert.equal(csrfRes.status, 200);
  const setCookie = csrfRes.headers.get("set-cookie") || "";
  assert.match(setCookie, /bn_csrf_token=[a-f0-9]{64}/);
  assert.match(setCookie, /SameSite=Lax/i);
  const { csrfToken } = await csrfRes.json();
  assert.equal(csrfToken.length, 64);

  // Cookie present but X-CSRF-Token missing -> 403 CSRF_TOKEN_INVALID
  const missingToken = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: `bn_csrf_token=${csrfToken}`,
    },
    body: JSON.stringify({
      name: "Cookie User",
      email: "cookie-missing@example.com",
      password: "csrf-test-password-123",
    }),
  });
  assert.equal(missingToken.status, 403);
  assert.equal((await missingToken.json()).code, "CSRF_TOKEN_INVALID");

  // Cookie present with mismatched X-CSRF-Token -> 403 CSRF_TOKEN_INVALID
  const wrongToken = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: `bn_csrf_token=${csrfToken}`,
      "X-CSRF-Token": "0".repeat(64),
    },
    body: JSON.stringify({
      name: "Cookie User",
      email: "cookie-wrong@example.com",
      password: "csrf-test-password-123",
    }),
  });
  assert.equal(wrongToken.status, 403);
  assert.equal((await wrongToken.json()).code, "CSRF_TOKEN_INVALID");

  // Cookie present with matching X-CSRF-Token -> 201 succeeds
  const validToken = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: `bn_csrf_token=${csrfToken}`,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      name: "Cookie User",
      email: "cookie-valid@example.com",
      password: "csrf-test-password-123",
    }),
  });
  assert.equal(validToken.status, 201);
});

test("server-to-server payment webhook is exempt from browser CSRF origin checks", async (t) => {
  const baseUrl = await withServer(t, { paymentWebhookSecret: "test-webhook-secret" });
  const res = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gateway.example",
    },
    body: JSON.stringify({ orderId: "ORD-1", status: "paid" }),
  });
  // Should reach webhook signature verification (401), NOT 403 CSRF
  assert.notEqual(res.status, 403);
});
