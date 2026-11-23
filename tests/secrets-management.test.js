"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertProductionEnvironment } = require("../scripts/predeploy-check");

const root = path.join(__dirname, "..");

const SECRET_KEYS = [
  "ADMIN_PASSWORD",
  "DATABASE_URL",
  "RATE_LIMIT_HMAC_KEY",
  "SEPAY_API_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "BACKUP_ENCRYPTION_KEY",
  "FIREBASE_API_KEY",
  "SMTP_PASSWORD",
  "RESEND_API_KEY",
  "MONITORING_ALERT_WEBHOOK_URL",
];

test(".gitignore, .env.example, and render.yaml keep all real secrets out of the repository", () => {
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);

  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  for (const key of SECRET_KEYS) {
    const match = envExample.match(new RegExp(`^${key}=(.*)$`, "m"));
    assert.ok(match, `.env.example must declare ${key}`);
    assert.equal(match[1].trim(), "", `.env.example must keep ${key} blank (no real secret)`);
  }

  const renderYaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  for (const key of [
    "DATABASE_URL",
    "RATE_LIMIT_HMAC_KEY",
    "SEPAY_API_KEY",
    "PAYMENT_WEBHOOK_SECRET",
    "BACKUP_ENCRYPTION_KEY",
    "FIREBASE_API_KEY",
    "ADMIN_PASSWORD",
    "SMTP_PASSWORD",
    "RESEND_API_KEY",
  ]) {
    assert.match(
      renderYaml,
      new RegExp(`key:\\s*${key}\\r?\\n\\s*sync:\\s*false`),
      `render.yaml must mark ${key} as sync: false`,
    );
  }
});

test("assertProductionEnvironment reports missing/weak secrets clearly without ever printing secret values", () => {
  const leakedCandidates = {
    shortAdminPw: "weak-pw-999",
    shortHmac: "short-hmac-key-888",
    shortWebhook: "short-webhook-777",
    badBackupKey: "not-32-bytes-key-666",
    badDbUrl: "mysql://user:super-secret-db-pw@host/db",
  };

  assert.throws(
    () =>
      assertProductionEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: leakedCandidates.badDbUrl,
        ADMIN_EMAIL: "admin@booknest.vn",
        ADMIN_PASSWORD: leakedCandidates.shortAdminPw,
        RATE_LIMIT_HMAC_KEY: leakedCandidates.shortHmac,
        PAYMENT_WEBHOOK_SECRET: leakedCandidates.shortWebhook,
        BACKUP_ENCRYPTION_REQUIRED: "true",
        BACKUP_ENCRYPTION_KEY: leakedCandidates.badBackupKey,
        CORS_ORIGINS: "https://booknest.example",
      }),
    (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /ADMIN_PASSWORD/);
      assert.match(error.message, /RATE_LIMIT_HMAC_KEY/);
      assert.match(error.message, /PAYMENT_WEBHOOK_SECRET/);
      assert.match(error.message, /BACKUP_ENCRYPTION_KEY/);
      for (const secretValue of Object.values(leakedCandidates)) {
        assert.equal(
          error.message.includes(secretValue),
          false,
          `Error message must NEVER echo secret value "${secretValue}"`,
        );
      }
      return true;
    },
  );
});

test("secrets management guide documents environment separation, access control, rotation, and revocation", () => {
  const doc = fs.readFileSync(path.join(root, "docs", "secrets-management.md"), "utf8");
  for (const keyword of [
    "sync: false",
    "PAYMENT_WEBHOOK_SECRET",
    "BACKUP_ENCRYPTION_KEY",
    "Rotation",
    "Least Privilege",
    "revoke-sessions",
  ]) {
    assert.ok(doc.includes(keyword), `docs/secrets-management.md must document "${keyword}"`);
  }
});
