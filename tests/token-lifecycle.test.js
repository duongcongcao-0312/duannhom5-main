"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createFirebaseIdTokenVerifier } = require("../backend/firebase-auth");
const { createServer } = require("../server");

async function withServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-token-lc-"));
  const auditLogPath = path.join(directory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
    loginAttemptLimit: 20,
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
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    auditLogPath,
  };
}

function base64UrlEncode(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

test("JWT verifier enforces RS256 algorithm, issuer, audience, and expiry before trusting Firebase lookup", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const projectId = "booknest-test-proj";
  let lookupCalls = 0;
  const verifier = createFirebaseIdTokenVerifier({
    apiKey: "test-firebase-api-key",
    projectId,
    fetchImpl: async (_url, options) => {
      lookupCalls += 1;
      const { idToken } = JSON.parse(options.body);
      if (idToken.endsWith("AAAA")) {
        return { ok: false, json: async () => ({ error: { message: "INVALID_ID_TOKEN" } }) };
      }
      return {
        ok: true,
        json: async () => ({
          users: [{
            localId: "uid-123",
            email: "jwt@example.com",
            displayName: "JWT User",
            emailVerified: true,
            providerUserInfo: [{ providerId: "google.com" }],
          }],
        }),
      };
    },
  });

  function signJwt(header, payload) {
    const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
    const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    return `${signingInput}.${sig.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const validPayload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: "uid-123",
    email: "jwt@example.com",
    email_verified: true,
    iat: nowSec - 10,
    exp: nowSec + 300,
    firebase: { sign_in_provider: "google.com" },
  };

  // Valid RS256 JWT passes
  const validJwt = signJwt({ alg: "RS256", kid: "kid-1", typ: "JWT" }, validPayload);
  const verified = await verifier(validJwt);
  assert.equal(verified.email, "jwt@example.com");
  assert.equal(lookupCalls, 1);

  // Bad algorithm (HS256 / none), bad issuer, bad audience, expired token are rejected locally without lookup
  const hsJwt = signJwt({ alg: "HS256", kid: "kid-1", typ: "JWT" }, validPayload);
  await assert.rejects(() => verifier(hsJwt), /Thuật toán/);

  const badIssJwt = signJwt({ alg: "RS256", kid: "kid-1" }, { ...validPayload, iss: "https://evil.example" });
  await assert.rejects(() => verifier(badIssJwt), /Issuer/);

  const badAudJwt = signJwt({ alg: "RS256", kid: "kid-1" }, { ...validPayload, aud: "wrong-project" });
  await assert.rejects(() => verifier(badAudJwt), /Issuer|audience/);

  const expiredJwt = signJwt({ alg: "RS256", kid: "kid-1" }, { ...validPayload, exp: nowSec - 5 });
  await assert.rejects(() => verifier(expiredJwt), /hết hạn/);
  assert.equal(lookupCalls, 1);

  // Tampered signature rejected by Firebase verification
  const tamperedJwt = `${validJwt.slice(0, -4)}AAAA`;
  await assert.rejects(() => verifier(tamperedJwt), /không hợp lệ/);
});

test("refresh token rotates on use, invalidates old access token, and revokes entire session family on replay", async (t) => {
  const { baseUrl, auditLogPath } = await withServer(t);

  // Register -> receive initial access token + refreshToken
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Rotation User",
      email: "rotate@example.com",
      password: "rotation-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token: token1, refreshToken: refresh1 } = await regRes.json();
  assert.ok(token1 && refresh1);

  // Forged/mismatched refresh token is rejected with 401
  const badRefresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token1}`,
    },
    body: JSON.stringify({ refreshToken: "forged-refresh-token" }),
  });
  assert.equal(badRefresh.status, 401);

  // Valid rotation issues brand-new token2 + refresh2
  const rotRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token1}`,
    },
    body: JSON.stringify({ refreshToken: refresh1 }),
  });
  assert.equal(rotRes.status, 200);
  const { token: token2, refreshToken: refresh2, rotated } = await rotRes.json();
  assert.equal(rotated, true);
  assert.notEqual(token2, token1);
  assert.notEqual(refresh2, refresh1);

  // Old access token1 is immediately rejected; new token2 works
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token1}` } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token2}` } })).status,
    200,
  );

  // Replay attack: attacker re-submits already-consumed refresh1 -> 401 REFRESH_TOKEN_REUSE_DETECTED
  const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token2}`,
    },
    body: JSON.stringify({ refreshToken: refresh1 }),
  });
  assert.equal(replayRes.status, 401);
  assert.equal((await replayRes.json()).code, "REFRESH_TOKEN_REUSE_DETECTED");

  // Even the newly rotated token2 is immediately revoked as part of full family revocation!
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token2}` } })).status,
    401,
  );

  // Audit log recorded reuse detection without leaking any raw token
  const rawAudit = await fs.readFile(auditLogPath, "utf8");
  assert.match(rawAudit, /"action":"auth\.refresh_token\.reuse_detected"/);
  assert.ok(!rawAudit.includes(refresh1));
  assert.ok(!rawAudit.includes(refresh2));
  assert.ok(!rawAudit.includes(token1));
  assert.ok(!rawAudit.includes(token2));
});

test("concurrent refresh requests with the same token serialize cleanly so only one succeeds", async (t) => {
  const { baseUrl } = await withServer(t);

  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Concurrent User",
      email: "concurrent@example.com",
      password: "concurrent-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  const { token, refreshToken } = await regRes.json();

  const [r1, r2] = await Promise.all([
    fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refreshToken }),
    }),
    fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refreshToken }),
    }),
  ]);
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 401]);
});
