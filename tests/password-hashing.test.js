"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PASSWORD_HASH_PARAMS,
  hashPassword,
  needsPasswordRehash,
  parsePasswordHash,
  verifyPassword,
} = require("../backend/auth");
const { createServer } = require("../server");

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-pwhash-"));
  const usersPath = path.join(directory, "users.json");
  const auditLogPath = path.join(directory, "audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath,
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath,
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
    usersPath,
    auditLogPath,
  };
}

test("hashPassword produces versioned scrypt hashes with unique random salts and verifyPassword validates safely", () => {
  const plain = "StrongBookNestPassword!2026";
  const h1 = hashPassword(plain);
  const h2 = hashPassword(plain);

  assert.notEqual(h1, h2, "unique random salt must yield distinct hashes");
  assert.ok(!h1.includes(plain), "hash must never contain plaintext password");
  assert.match(h1, /^scrypt\$N=16384,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);

  const parsed = parsePasswordHash(h1);
  assert.equal(parsed.algorithm, "scrypt");
  assert.equal(parsed.N, PASSWORD_HASH_PARAMS.N);
  assert.equal(parsed.r, PASSWORD_HASH_PARAMS.r);
  assert.equal(parsed.p, PASSWORD_HASH_PARAMS.p);
  assert.equal(parsed.legacy, false);

  assert.equal(verifyPassword(plain, h1), true);
  assert.equal(verifyPassword("wrong-password-123", h1), false);
  assert.equal(verifyPassword("", h1), false);
  assert.equal(verifyPassword(plain, "not-a-valid-hash"), false);
  assert.equal(verifyPassword(plain, "scrypt$N=999,r=8,p=1$abcd$ef01"), false);
  assert.equal(needsPasswordRehash(h1), false);

  // Lower-cost hash triggers needsPasswordRehash
  const lowerCost = hashPassword(plain, { ...PASSWORD_HASH_PARAMS, N: 4096 });
  assert.equal(verifyPassword(plain, lowerCost), true);
  assert.equal(needsPasswordRehash(lowerCost), true);
});

test("legacy salt:hash passwords verify and transparently upgrade to versioned scrypt format on login without leaking secrets", async (t) => {
  const { baseUrl, usersPath, auditLogPath } = await withServer(t);
  const plain = "LegacyUserPassword!2026";
  const legacySalt = crypto.randomBytes(16).toString("hex");
  const legacyHash = `${legacySalt}:${crypto.scryptSync(plain, legacySalt, 64).toString("hex")}`;
  assert.equal(verifyPassword(plain, legacyHash), true);
  assert.equal(needsPasswordRehash(legacyHash), true);

  // Register a user then overwrite their stored password with a legacy salt:hash
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Legacy User", email: "legacy@example.com", password: plain }),
  });
  assert.equal(reg.status, 201);

  const users = JSON.parse(await fs.readFile(usersPath, "utf8"));
  const target = users.find((u) => u.email === "legacy@example.com");
  assert.ok(target);
  target.password = legacyHash;
  await fs.writeFile(usersPath, JSON.stringify(users, null, 2), "utf8");

  // Login with legacy hash -> succeeds and transparently upgrades stored hash
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "legacy@example.com", password: plain }),
  });
  assert.equal(loginRes.status, 200);
  const loginText = await loginRes.text();
  assert.ok(!loginText.includes(plain));
  assert.ok(!loginText.includes(legacyHash));
  assert.ok(!loginText.includes("scrypt$"));

  const upgradedUsers = JSON.parse(await fs.readFile(usersPath, "utf8"));
  const upgradedTarget = upgradedUsers.find((u) => u.email === "legacy@example.com");
  assert.match(upgradedTarget.password, /^scrypt\$N=16384,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(needsPasswordRehash(upgradedTarget.password), false);
  assert.equal(verifyPassword(plain, upgradedTarget.password), true);

  // Subsequent login works with upgraded hash
  const secondLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "legacy@example.com", password: plain }),
  });
  assert.equal(secondLogin.status, 200);

  // Audit log recorded upgrade without leaking password or hash
  const rawAudit = await fs.readFile(auditLogPath, "utf8");
  assert.match(rawAudit, /"action":"auth\.password\.rehashed"/);
  assert.ok(!rawAudit.includes(plain));
  assert.ok(!rawAudit.includes(legacyHash));
  assert.ok(!rawAudit.includes(upgradedTarget.password));
});

test("password hashing policy document covers algorithm, cost parameters, and upgrade plan", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "password-hashing.md"), "utf8");
  assert.match(doc, /scrypt/i);
  assert.match(doc, /16384/);
  assert.match(doc, /timingSafeEqual/);
  assert.match(doc, /needsPasswordRehash/);
});
