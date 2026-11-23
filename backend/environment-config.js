"use strict";

const { resolveAppEnvironment } = require("./env-isolation");
const net = require("node:net");
const path = require("node:path");

// This is the canonical inventory for variables consumed by the application,
// deployment scripts, and operational tooling. Never include values in errors.
const ENVIRONMENT_VARIABLES = Object.freeze([
  { name: "APP_ENV", type: "enum", scope: "all", values: ["development", "test", "staging", "production"] },
  { name: "NODE_ENV", type: "enum", scope: "runtime", values: ["development", "test", "production"] },
  { name: "HOST", type: "hostname", scope: "runtime" },
  { name: "PORT", type: "integer", scope: "runtime", min: 1, max: 65535 },
  { name: "DATABASE_URL", type: "postgres-url", scope: "backend", secret: true },
  { name: "EXPECTED_DATABASE_NAME", type: "string", scope: "production/staging" },
  { name: "DATABASE_SSL_CA_PATH", type: "path", scope: "backend" },
  { name: "PG_POOL_MAX", type: "integer", scope: "backend", min: 1, max: 1000 },
  { name: "PG_POOL_IDLE_TIMEOUT_MS", type: "integer", scope: "backend", min: 1, max: 86400000 },
  { name: "PG_POOL_MAX_LIFETIME_SECONDS", type: "integer", scope: "backend", min: 1, max: 86400 },
  { name: "ADMIN_NAME", type: "string", scope: "backend" },
  { name: "ADMIN_EMAIL", type: "email", scope: "production", secret: true },
  { name: "ADMIN_PASSWORD", type: "password", scope: "production", secret: true },
  { name: "RATE_LIMIT_HMAC_KEY", type: "secret-utf8-32+", scope: "production", secret: true },
  { name: "RATE_LIMIT_TRUSTED_PROXY_HOPS", type: "integer", scope: "backend", min: 0, max: 32 },
  { name: "RATE_LIMIT_TRUSTED_PROXY_IPS", type: "ip-list", scope: "backend" },
  { name: "API_RATE_LIMIT", type: "integer", scope: "backend", min: 1, max: 1000000 },
  { name: "API_RATE_WINDOW_MS", type: "integer", scope: "backend", min: 1, max: 86400000 },
  { name: "MAX_CONCURRENT_REQUESTS", type: "integer", scope: "backend", min: 1, max: 1000 },
  { name: "REQUEST_TIMEOUT_MS", type: "integer", scope: "backend", min: 1000, max: 120000 },
  { name: "CORS_ORIGINS", type: "origin-list", scope: "backend" },
  { name: "MONITORING_ALERT_WEBHOOK_URL", type: "https-url", scope: "backend", secret: true },
  { name: "PAYMENT_WEBHOOK_SECRET", type: "secret-utf8-32+", scope: "payment", secret: true },
  { name: "SEPAY_API_KEY", type: "secret-utf8-16+", scope: "payment", secret: true },
  { name: "SEPAY_BANK_CODE", type: "six-digit-code", scope: "payment" },
  { name: "SEPAY_BANK_NAME", type: "string", scope: "payment" },
  { name: "SEPAY_ACCOUNT_NUMBER", type: "account-number", scope: "payment", secret: true },
  { name: "SEPAY_ACCOUNT_NAME", type: "string", scope: "payment" },
  { name: "FIREBASE_API_KEY", type: "string", scope: "social-auth" },
  { name: "FIREBASE_PROJECT_ID", type: "string", scope: "social-auth" },
  { name: "PUBLIC_APP_URL", type: "http-url", scope: "backend" },
  { name: "SMTP_HOST", type: "hostname", scope: "email" },
  { name: "SMTP_PORT", type: "integer", scope: "email", min: 1, max: 65535 },
  { name: "SMTP_FROM", type: "email-or-mailbox", scope: "email" },
  { name: "SMTP_USER", type: "string", scope: "email", secret: true },
  { name: "SMTP_PASSWORD", type: "string", scope: "email", secret: true },
  { name: "RESEND_API_KEY", type: "string", scope: "email", secret: true },
  { name: "RESEND_FROM", type: "email-or-mailbox", scope: "email" },
  { name: "SESSION_TTL_MS", type: "integer", scope: "backend", min: 1, max: 31536000000 },
  { name: "SESSION_IDLE_TIMEOUT_MS", type: "integer", scope: "backend", min: 0, max: 31536000000 },
  { name: "SESSION_REFRESH_TTL_MS", type: "integer", scope: "backend", min: 1, max: 31536000000 },
  { name: "PRIVACY_EXPORT_TTL_MS", type: "integer", scope: "backend", min: 1, max: 86400000 },
  { name: "PASSWORD_MIN_LENGTH", type: "integer", scope: "backend", min: 8, max: 128 },
  { name: "PASSWORD_MAX_LENGTH", type: "integer", scope: "backend", min: 12, max: 1024 },
  { name: "SESSION_COOKIE_SAMESITE", type: "enum", scope: "backend", values: ["lax", "strict", "none"] },
  { name: "BACKUP_DIR", type: "path", scope: "backup" },
  { name: "DATA_DIR", type: "path", scope: "backend/backup" },
  { name: "BACKUP_STATUS_FILE", type: "path", scope: "backend/backup" },
  { name: "BACKUP_INTERVAL_HOURS", type: "integer", scope: "backup", min: 1, max: 8760 },
  { name: "BACKUP_RETENTION_DAYS", type: "integer", scope: "backup", min: 1, max: 3650 },
  { name: "BACKUP_LOG_FILE", type: "path", scope: "backup" },
  { name: "BACKUP_ALERT_TIMEOUT_MS", type: "integer", scope: "backup", min: 1, max: 120000 },
  { name: "BACKUP_ALERT_WEBHOOK_URL", type: "https-url", scope: "backup", secret: true },
  { name: "DATABASE_BACKUP_TIMEOUT_MS", type: "integer", scope: "backup", min: 1, max: 86400000 },
  { name: "PG_DUMP_PATH", type: "path-or-command", scope: "backup" },
  { name: "PG_RESTORE_PATH", type: "path-or-command", scope: "backup" },
  { name: "BACKUP_ENCRYPTION_KEY", type: "base64-32-byte-key", scope: "backup", secret: true },
  { name: "BACKUP_ENCRYPTION_REQUIRED", type: "boolean", scope: "backup" },
  { name: "ALLOW_LOCAL_PROD_DB", type: "boolean", scope: "production" },
  { name: "API_BASE_URL", type: "http-url", scope: "frontend-build" },
  { name: "SMOKE_BASE_URL", type: "http-url", scope: "smoke-test" },
  { name: "SMOKE_TIMEOUT_MS", type: "integer", scope: "smoke-test", min: 1, max: 120000 },
  { name: "SMOKE_ALERT_WEBHOOK_URL", type: "https-url", scope: "smoke-test", secret: true },
  { name: "PERF_BASE_URL", type: "http-url", scope: "performance-test" },
  { name: "PERF_BROWSER", type: "path", scope: "performance-test" },
  { name: "PERF_ITERATION", type: "integer", scope: "performance-test", min: 1, max: 100000 },
  { name: "PERF_PAGE", type: "string", scope: "performance-test" },
  { name: "PERF_VIEWPORT", type: "integer", scope: "performance-test", min: 1, max: 10000 },
  { name: "PERF_REPEAT", type: "integer", scope: "performance-test", min: 1, max: 10000 },
  { name: "LOAD_TEST_BASE_URL", type: "http-url", scope: "load-test" },
  { name: "LOAD_TEST_STAGING_HOSTS", type: "hostname-list", scope: "load-test" },
  { name: "LOAD_TEST_ALLOW_STAGING", type: "boolean", scope: "load-test" },
  { name: "LOAD_TEST_REQUESTS", type: "integer", scope: "load-test", min: 1, max: 1000000 },
  { name: "LOAD_TEST_CONCURRENCY", type: "integer", scope: "load-test", min: 1, max: 10000 },
  { name: "LOAD_TEST_TIMEOUT_MS", type: "integer", scope: "load-test", min: 1, max: 86400000 },
  { name: "LOAD_TEST_SLO_P95_MS", type: "integer", scope: "load-test", min: 1, max: 86400000 },
  { name: "LOAD_TEST_SLO_ERROR_RATE", type: "number", scope: "load-test", min: 0, max: 1 },
  { name: "LOAD_TEST_SLO_THROUGHPUT_RPS", type: "number", scope: "load-test", min: 0, max: 1000000 },
  { name: "LOAD_TEST_PROFILE", type: "enum", scope: "load-test", values: ["standard", "spike"] },
  { name: "NODE_VERSION", type: "major-version", scope: "deployment" },
  { name: "HOST_PORT", type: "integer", scope: "local-compose", min: 1, max: 65535 },
  { name: "GITHUB_TOKEN", type: "secret", scope: "issue-maintenance", secret: true },
  { name: "GH_TOKEN", type: "secret", scope: "issue-maintenance", secret: true },
  { name: "REPO", type: "repository", scope: "issue-maintenance" },
]);

function isUrl(value, protocols) {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) return false;
    if (["postgres:", "postgresql:"].includes(url.protocol)) {
      return Boolean(url.hostname && url.pathname.replace(/^\/+/, ""));
    }
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateEnvironment(env = process.env) {
  const errors = [];
  const add = (name, requirement) => errors.push(`${name} ${requirement}.`);
  let appEnvironment = "development";
  try {
    appEnvironment = resolveAppEnvironment(env);
  } catch {
    add("APP_ENV", "must be development, test, staging, or production");
  }
  const production = appEnvironment === "production" || appEnvironment === "staging";

  for (const spec of ENVIRONMENT_VARIABLES) {
    const raw = env[spec.name];
    if (raw === undefined || String(raw).trim() === "") continue;
    const value = String(raw).trim();
    if (spec.type === "integer" || spec.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number) || (spec.type === "integer" && !Number.isSafeInteger(number)) || number < spec.min || number > spec.max) {
        add(spec.name, `must be a ${spec.type} between ${spec.min} and ${spec.max}`);
      }
    } else if (spec.type === "boolean" && !["true", "false"].includes(value.toLowerCase())) {
      add(spec.name, "must be true or false");
    } else if (spec.type === "enum" && !spec.values.includes(value.toLowerCase())) {
      add(spec.name, `must be one of ${spec.values.join(", ")}`);
    } else if (spec.type === "postgres-url" && !isUrl(value, ["postgres:", "postgresql:"])) {
      add(spec.name, "must be a valid PostgreSQL URL");
    } else if (spec.type === "http-url" && !isUrl(value, ["http:", "https:"])) {
      add(spec.name, "must be a valid HTTP(S) URL");
    } else if (spec.type === "https-url" && !isUrl(value, ["https:"])) {
      add(spec.name, "must be a valid HTTPS URL without embedded credentials");
    } else if (spec.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      add(spec.name, "must be a valid email address");
    } else if (spec.type === "email-or-mailbox" && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.replace(/^.*<|>$/g, ""))) {
      add(spec.name, "must contain a valid email mailbox");
    } else if (spec.type === "secret-utf8-32+" && Buffer.byteLength(String(raw), "utf8") < 32) {
      add(spec.name, "must be at least 32 bytes when configured");
    } else if (spec.type === "secret-utf8-16+" && (Buffer.byteLength(String(raw), "utf8") < 16 || /\s/.test(String(raw)))) {
      add(spec.name, "must be at least 16 bytes without whitespace when configured");
    } else if (spec.type === "six-digit-code" && !/^\d{6}$/.test(value)) {
      add(spec.name, "must contain exactly six digits");
    } else if (spec.type === "account-number" && !/^\d{6,19}$/.test(value)) {
      add(spec.name, "must contain 6 to 19 digits");
    } else if (spec.type === "base64-32-byte-key") {
      const decoded = Buffer.from(value, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== value) add(spec.name, "must be base64 for exactly 32 bytes");
    } else if (spec.type === "ip-list") {
      const { parseTrustedProxyIps } = require("./security");
      try { parseTrustedProxyIps(value); } catch { add(spec.name, "must be a comma-separated list of valid IP addresses"); }
    } else if (spec.type === "origin-list") {
      for (const origin of value.split(",").map((part) => part.trim()).filter(Boolean)) {
        try {
          const url = new URL(origin);
          if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password || (production && url.protocol !== "https:")) throw new Error("invalid");
        } catch { add(spec.name, "must contain only valid origins (HTTPS in staging/production)"); break; }
      }
    } else if (spec.type === "repository" && !/^[\w.-]+\/[\w.-]+$/.test(value)) {
      add(spec.name, "must use owner/repository format");
    } else if (spec.type === "major-version" && !/^\d{1,2}$/.test(value)) {
      add(spec.name, "must be a major version number");
    } else if (spec.type === "hostname" && value !== "0.0.0.0" && value !== "::" && net.isIP(value) === 0 &&
        (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(value))) {
      add(spec.name, "must be a hostname or IP address");
    } else if (spec.type === "path" && value.includes("\0")) {
      add(spec.name, "must be a valid filesystem path");
    } else if (spec.type === "path-or-command" && (value.includes("\0") || path.basename(value) === ".")) {
      add(spec.name, "must be a valid executable path or command name");
    } else if (spec.type === "hostname-list" && value.split(",").some((host) => !/^(?=.{1,253}$)[a-z0-9.-]+$/i.test(host.trim()))) {
      add(spec.name, "must be a comma-separated list of hostnames");
    }
  }

  const nodeEnv = String(env.NODE_ENV || "").toLowerCase();
  if (env.APP_ENV && env.NODE_ENV &&
      ((appEnvironment === "production" && nodeEnv !== "production") || (appEnvironment === "staging" && nodeEnv !== "production"))) {
    add("NODE_ENV", `must be production when APP_ENV=${appEnvironment}`);
  }
  if (production) {
    if (!env.DATABASE_URL) add("DATABASE_URL", "is required in staging/production");
    if (!env.ADMIN_EMAIL) add("ADMIN_EMAIL", "is required in staging/production");
    if (!env.ADMIN_PASSWORD || String(env.ADMIN_PASSWORD).trim().length < 12) add("ADMIN_PASSWORD", "must contain at least 12 non-space characters");
    if (!env.RATE_LIMIT_HMAC_KEY || Buffer.byteLength(String(env.RATE_LIMIT_HMAC_KEY), "utf8") < 32) add("RATE_LIMIT_HMAC_KEY", "must contain at least 32 bytes in staging/production");
    if (!env.CORS_ORIGINS) add("CORS_ORIGINS", "is required in staging/production");
    const { normalizeSePayConfig } = require("./sepay-config");
    const sepay = normalizeSePayConfig({
      apiKey: env.SEPAY_API_KEY,
      bankCode: env.SEPAY_BANK_CODE,
      bankName: env.SEPAY_BANK_NAME,
      accountNumber: env.SEPAY_ACCOUNT_NUMBER,
      accountName: env.SEPAY_ACCOUNT_NAME,
    });
    if (!sepay.valid) add("SEPAY_API_KEY, SEPAY_BANK_CODE, SEPAY_BANK_NAME, SEPAY_ACCOUNT_NUMBER, SEPAY_ACCOUNT_NAME", "must be valid for staging/production payment configuration");
  }
  if (env.CORS_ORIGINS && !String(env.CORS_ORIGINS).split(",").some((origin) => origin.trim())) {
    add("CORS_ORIGINS", "must contain at least one origin");
  }
  if (String(env.RATE_LIMIT_TRUSTED_PROXY_HOPS || "0") !== "0" && !env.RATE_LIMIT_TRUSTED_PROXY_IPS) {
    add("RATE_LIMIT_TRUSTED_PROXY_IPS", "is required when proxy hops are trusted");
  }
  if (Number(env.PASSWORD_MIN_LENGTH || 12) > Number(env.PASSWORD_MAX_LENGTH || 128)) {
    add("PASSWORD_MIN_LENGTH", "must not exceed PASSWORD_MAX_LENGTH");
  }
  if (Boolean(env.ADMIN_EMAIL) !== Boolean(env.ADMIN_PASSWORD)) {
    add("ADMIN_EMAIL/ADMIN_PASSWORD", "must be configured together");
  }
  if (String(env.BACKUP_ENCRYPTION_REQUIRED || "false").toLowerCase() === "true" && !env.BACKUP_ENCRYPTION_KEY) {
    add("BACKUP_ENCRYPTION_KEY", "is required when BACKUP_ENCRYPTION_REQUIRED=true");
  }
  const hasAnySePaySetting = ["SEPAY_API_KEY", "SEPAY_BANK_CODE", "SEPAY_BANK_NAME", "SEPAY_ACCOUNT_NUMBER", "SEPAY_ACCOUNT_NAME"]
    .some((name) => Boolean(env[name]));
  if (hasAnySePaySetting && !production) {
    const { normalizeSePayConfig } = require("./sepay-config");
    const sepay = normalizeSePayConfig({
      apiKey: env.SEPAY_API_KEY,
      bankCode: env.SEPAY_BANK_CODE,
      bankName: env.SEPAY_BANK_NAME,
      accountNumber: env.SEPAY_ACCOUNT_NUMBER,
      accountName: env.SEPAY_ACCOUNT_NAME,
    });
    if (!sepay.valid) add("SEPAY_API_KEY, SEPAY_BANK_CODE, SEPAY_BANK_NAME, SEPAY_ACCOUNT_NUMBER, SEPAY_ACCOUNT_NAME", "must be configured together with valid values");
  }
  const configuredBackupDir = path.resolve(String(env.BACKUP_DIR || "backups"));
  const configuredDataDir = path.resolve(String(env.DATA_DIR || "data"));
  const backupRelative = path.relative(configuredBackupDir, configuredDataDir);
  const dataRelative = path.relative(configuredDataDir, configuredBackupDir);
  const directoriesOverlap = (relative) => relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  if (directoriesOverlap(backupRelative) || directoriesOverlap(dataRelative)) {
    add("BACKUP_DIR/DATA_DIR", "must not refer to the same or nested directories");
  }
  const hasSmtpSettings = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"]
    .some((name) => Boolean(env[name]));
  if (hasSmtpSettings && (!env.SMTP_HOST || !env.SMTP_FROM)) {
    add("SMTP_HOST/SMTP_FROM", "must both be set to enable SMTP delivery");
  }
  for (const [first, second] of [["RESEND_API_KEY", "RESEND_FROM"], ["SMTP_USER", "SMTP_PASSWORD"]]) {
    if (Boolean(env[first]) !== Boolean(env[second])) add(`${first}/${second}`, "must be configured together");
  }
  if (env.RESEND_API_KEY && env.SMTP_HOST) {
    add("RESEND_API_KEY/SMTP_HOST", "must select only one email provider");
  }
  if (errors.length) throw new Error(`Invalid environment configuration: ${errors.join(" ")}`);
  return { environment: appEnvironment, variables: ENVIRONMENT_VARIABLES };
}

module.exports = { ENVIRONMENT_VARIABLES, validateEnvironment };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  try {
    const config = validateEnvironment(process.env);
    console.log(JSON.stringify({ event: "environment_config_valid", environment: config.environment, variableCount: ENVIRONMENT_VARIABLES.length }));
  } catch (error) {
    console.error(`Environment configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}
