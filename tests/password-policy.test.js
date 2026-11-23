"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY,
  isPasswordValid,
  validatePasswordPolicy,
} = require("../backend/auth");
const { createServer } = require("../server");

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-pwpolicy-"));
  let lastResetUrl = "";
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
    appBaseUrl: "https://booknest.example",
    passwordResetMailer: {
      sendPasswordReset: async ({ url }) => {
        lastResetUrl = url;
      },
    },
    registrationAttemptLimit: 20,
    loginAttemptLimit: 20,
    passwordResetIpLimit: 20,
    passwordResetEmailLimit: 20,
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
    getLastResetToken: () => {
      const hash = new URL(lastResetUrl).hash.replace(/^#/, "");
      return new URLSearchParams(hash).get("resetToken");
    },
  };
}

test("validatePasswordPolicy enforces min/max length, weak password checks, and email mismatch consistently", () => {
  assert.equal(PASSWORD_POLICY.minLength, PASSWORD_MIN_LENGTH);
  assert.equal(PASSWORD_POLICY.maxLength, PASSWORD_MAX_LENGTH);

  // Too short / too long / whitespace-only
  assert.equal(validatePasswordPolicy("short123").code, "PASSWORD_POLICY_LENGTH");
  assert.equal(validatePasswordPolicy("a".repeat(129)).code, "PASSWORD_POLICY_LENGTH");
  assert.equal(validatePasswordPolicy("            ").code, "PASSWORD_POLICY_LENGTH");

  // Control characters
  assert.equal(validatePasswordPolicy("valid-pass\n12345").code, "PASSWORD_POLICY_INVALID_CHARS");

  // Repeated / low-entropy characters
  assert.equal(validatePasswordPolicy("aaaaaaaaaaaa").code, "PASSWORD_POLICY_WEAK");
  assert.equal(validatePasswordPolicy("abababababab").code, "PASSWORD_POLICY_WEAK");

  // Common weak passwords & digits-only
  assert.equal(validatePasswordPolicy("password1234").code, "PASSWORD_POLICY_COMMON");
  assert.equal(validatePasswordPolicy("123456789012").code, "PASSWORD_POLICY_COMMON");
  assert.equal(validatePasswordPolicy("987654321098").code, "PASSWORD_POLICY_COMMON");

  // Matches user email or local-part
  assert.equal(
    validatePasswordPolicy("policyuser@example.com", { email: "policyuser@example.com" }).code,
    "PASSWORD_POLICY_PERSONAL",
  );
  assert.equal(
    validatePasswordPolicy("policyuser123", { email: "policyuser123@example.com" }).code,
    "PASSWORD_POLICY_PERSONAL",
  );

  // Strong passphrase passes
  assert.equal(isPasswordValid("Correct-Horse-Battery-2026!", { email: "policyuser@example.com" }), true);
});

test("register, change-password, and password-reset/confirm enforce the same password policy without echoing secrets", async (t) => {
  const { baseUrl, getLastResetToken } = await withServer(t);
  const email = "policy-check@example.com";

  // 1. Register rejects weak/common/email-matching passwords without echoing password
  for (const weak of ["short", "password1234", "aaaaaaaaaaaa", email]) {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Policy User", email, password: weak }),
    });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.ok(!text.includes(weak), `error response must not echo rejected password: ${weak}`);
  }

  // Register with strong password succeeds
  const initialPassword = "Initial-Strong-Password!2026";
  const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Policy User", email, password: initialPassword }),
  });
  assert.equal(reg.status, 201);
  const { token } = await reg.json();

  // 2. Change-password rejects weak password and reuse of current password
  const weakChange = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: "password1234" }),
  });
  assert.equal(weakChange.status, 400);
  assert.equal((await weakChange.json()).code, "PASSWORD_POLICY_COMMON");

  const reuseChange = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: initialPassword }),
  });
  assert.equal(reuseChange.status, 400);
  assert.equal((await reuseChange.json()).code, "PASSWORD_POLICY_REUSE");

  // Valid change-password succeeds, rotates session, revokes old token
  const secondPassword = "Rotated-Strong-Password!2026";
  const okChange = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: secondPassword }),
  });
  assert.equal(okChange.status, 200);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status,
    401,
  );

  // 3. Password reset confirm enforces the exact same policy
  const reqReset = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(reqReset.status, 200);
  const resetToken = getLastResetToken();
  assert.ok(resetToken);

  const weakReset = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: "qwerty123456" }),
  });
  assert.equal(weakReset.status, 400);
  assert.equal((await weakReset.json()).code, "PASSWORD_POLICY_COMMON");

  const strongReset = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: "Reset-Strong-Password!2026" }),
  });
  assert.equal(strongReset.status, 200);
});

test("password policy documentation exists and describes standardized rules", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "password-policy.md"), "utf8");
  assert.match(doc, /PASSWORD_MIN_LENGTH|12 ký tự/);
  assert.match(doc, /PASSWORD_MAX_LENGTH|128 ký tự/);
  assert.match(doc, /validatePasswordPolicy/);
  assert.match(doc, /change-password/);
});
