"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-cookie-auth-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    corsOrigins: "https://store.booknest.example",
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

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseCookiePair(setCookieList, name) {
  const match = setCookieList.find((line) => line.startsWith(`${name}=`));
  if (!match) return { raw: "", value: "" };
  const value = match.slice(name.length + 1).split(";")[0];
  return { raw: match, value };
}

test("auth flows issue HttpOnly SameSite session cookies, enforce CSRF on cookie mutations, and clear cookies on logout", async (t) => {
  const baseUrl = await withServer(t);

  // 1. Register issues bn_session (HttpOnly, SameSite=Lax, Max-Age) + bn_csrf_token
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://store.booknest.example",
    },
    body: JSON.stringify({
      name: "Cookie Session User",
      email: "cookie-session@example.com",
      password: "cookie-session-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.headers.get("access-control-allow-origin"), "https://store.booknest.example");
  assert.equal(regRes.headers.get("access-control-allow-credentials"), "true");

  const regCookies = getSetCookies(regRes);
  const sessionCookie = parseCookiePair(regCookies, "bn_session");
  const csrfCookie = parseCookiePair(regCookies, "bn_csrf_token");
  assert.ok(sessionCookie.value.length >= 32);
  assert.match(sessionCookie.raw, /HttpOnly/i);
  assert.match(sessionCookie.raw, /SameSite=Lax/i);
  assert.match(sessionCookie.raw, /Path=\//i);
  assert.match(sessionCookie.raw, /Max-Age=\d+/i);
  assert.equal(csrfCookie.value.length, 64);

  const cookieHeader = `bn_session=${sessionCookie.value}; bn_csrf_token=${csrfCookie.value}`;

  // 2. Cookie-only GET /api/v1/auth/me works without Authorization header
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(meRes.status, 200);
  const meBody = await meRes.json();
  assert.equal(meBody.user.email, "cookie-session@example.com");

  // 3. Cookie-authenticated state change WITHOUT X-CSRF-Token is blocked (403)
  const refreshNoCsrf = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: cookieHeader,
    },
  });
  assert.equal(refreshNoCsrf.status, 403);
  assert.equal((await refreshNoCsrf.json()).code, "CSRF_TOKEN_INVALID");

  // 4. Cookie-authenticated refresh WITH matching X-CSRF-Token succeeds & re-issues cookies
  const refreshOk = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: cookieHeader,
      "X-CSRF-Token": csrfCookie.value,
    },
  });
  assert.equal(refreshOk.status, 200);
  const refreshedCookies = getSetCookies(refreshOk);
  const refreshedSession = parseCookiePair(refreshedCookies, "bn_session");
  const refreshedCsrf = parseCookiePair(refreshedCookies, "bn_csrf_token");
  assert.ok(refreshedSession.value.length >= 32);
  assert.equal(refreshedCsrf.value.length, 64);

  // 5. Cookie-authenticated logout revokes session and clears both cookies (Max-Age=0)
  const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: `bn_session=${refreshedSession.value}; bn_csrf_token=${refreshedCsrf.value}`,
      "X-CSRF-Token": refreshedCsrf.value,
    },
  });
  assert.equal(logoutRes.status, 200);
  const clearCookies = getSetCookies(logoutRes);
  assert.match(parseCookiePair(clearCookies, "bn_session").raw, /Max-Age=0/i);
  assert.match(parseCookiePair(clearCookies, "bn_csrf_token").raw, /Max-Age=0/i);

  // 6. Revoked cookie can no longer access /api/v1/auth/me
  const meAfterLogout = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: `bn_session=${refreshedSession.value}` },
  });
  assert.equal(meAfterLogout.status, 401);

  // 7. HTTPS/forwarded-proto sets Secure attribute on session cookie
  const httpsLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Proto": "https",
    },
    body: JSON.stringify({
      email: "cookie-session@example.com",
      password: "cookie-session-password-123",
    }),
  });
  assert.equal(httpsLogin.status, 200);
  const httpsCookies = getSetCookies(httpsLogin);
  assert.match(parseCookiePair(httpsCookies, "bn_session").raw, /;\s*Secure/i);
  assert.match(parseCookiePair(httpsCookies, "bn_session").raw, /;\s*HttpOnly/i);
});

test("session storage evaluation document exists and covers HttpOnly, Secure, SameSite, CORS, and CSRF", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "auth-session-storage.md"), "utf8");
  assert.match(doc, /sessionStorage/);
  assert.match(doc, /HttpOnly/);
  assert.match(doc, /Secure/);
  assert.match(doc, /SameSite/);
  assert.match(doc, /Access-Control-Allow-Credentials/);
  assert.match(doc, /X-CSRF-Token/);
});
