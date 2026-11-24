const fs = require("node:fs");
const path = require("node:path");
const { normalizeSePayConfig } = require("../backend/sepay-config");
const { parseTrustedProxyIps } = require("../backend/security");
const { validateDatabaseEnvironmentIsolation } = require("../backend/env-isolation");
const { validateEnvironment } = require("../backend/environment-config");

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const NON_PRODUCTION_MARKER = /(?:^|[-_.])(dev|development|staging|stage|test|local)(?:$|[-_.])/i;

function validateProductionEndpoints(env, failures) {
  const environment = String(env.APP_ENV || env.NODE_ENV || "").trim().toLowerCase();
  if (environment !== "production") return;

  if (String(env.ALLOW_LOCAL_PROD_DB || "").trim().toLowerCase() === "true") {
    failures.push("ALLOW_LOCAL_PROD_DB must not be enabled for a production release.");
  }

  for (const name of ["PUBLIC_APP_URL", "API_BASE_URL"]) {
    const raw = String(env[name] || "").trim();
    if (!raw) {
      if (name === "PUBLIC_APP_URL") failures.push("Production requires PUBLIC_APP_URL.");
      continue;
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      failures.push(`${name} must be a valid public HTTPS URL.`);
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase()) ||
        NON_PRODUCTION_MARKER.test(parsed.hostname)) {
      failures.push(`${name} must use a public HTTPS production host without embedded credentials.`);
    }
  }

  const origins = String(env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (LOCAL_HOSTNAMES.has(hostname) || NON_PRODUCTION_MARKER.test(hostname)) {
        failures.push("Production CORS_ORIGINS must not include local or staging hosts.");
        break;
      }
    } catch {
      // The canonical environment validator reports malformed origins without echoing them.
    }
  }

  if (/(?:^|\s)--(?:inspect|inspect-brk)(?:=|\s|$)/i.test(String(env.NODE_OPTIONS || ""))) {
    failures.push("NODE_OPTIONS must not enable the Node.js inspector in production.");
  }
  if (String(env.DEBUG || "").trim()) {
    failures.push("DEBUG must not be enabled in production.");
  }
}

function assertProductionEnvironment(env = process.env) {
  const failures = [];
  try {
    validateEnvironment(env);
  } catch (error) {
    failures.push(error.message);
  }
  validateProductionEndpoints(env, failures);
  if (
    env.PAYMENT_WEBHOOK_SECRET !== undefined &&
    String(env.PAYMENT_WEBHOOK_SECRET).trim() !== "" &&
    Buffer.byteLength(String(env.PAYMENT_WEBHOOK_SECRET), "utf8") < 32
  ) {
    failures.push("PAYMENT_WEBHOOK_SECRET must be at least 32 bytes when configured.");
  }

  if (String(env.BACKUP_ENCRYPTION_REQUIRED || "").toLowerCase() === "true") {
    const rawKey = String(env.BACKUP_ENCRYPTION_KEY || "").trim();
    const keyBytes = rawKey ? Buffer.from(rawKey, "base64") : Buffer.alloc(0);
    if (keyBytes.length !== 32) {
      failures.push("BACKUP_ENCRYPTION_KEY must be a valid 32-byte base64 key when BACKUP_ENCRYPTION_REQUIRED=true.");
    }
  }

  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    let databaseUrl;
    try {
      databaseUrl = new URL(String(env.DATABASE_URL || ""));
    } catch {
      databaseUrl = null;
    }
    if (!databaseUrl || !["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !databaseUrl.hostname) {
      failures.push("Production requires a valid PostgreSQL DATABASE_URL.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(env.ADMIN_EMAIL || "").trim())) {
      failures.push("ADMIN_EMAIL phải là email hợp lệ.");
    }
    if (typeof env.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.trim().length < 12) {
      failures.push("ADMIN_PASSWORD must contain at least 12 non-space characters.");
    }
    if (
      typeof env.RATE_LIMIT_HMAC_KEY !== "string" ||
      Buffer.byteLength(env.RATE_LIMIT_HMAC_KEY) < 32
    ) {
      failures.push("Production requires a RATE_LIMIT_HMAC_KEY of at least 32 bytes.");
    }
  }

  const trustedProxyHops = env.RATE_LIMIT_TRUSTED_PROXY_HOPS === undefined ||
    String(env.RATE_LIMIT_TRUSTED_PROXY_HOPS).trim() === ""
    ? 0
    : Number(env.RATE_LIMIT_TRUSTED_PROXY_HOPS);
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    failures.push("RATE_LIMIT_TRUSTED_PROXY_HOPS must be a non-negative integer.");
  }
  let trustedProxyIps = [];
  try {
    trustedProxyIps = parseTrustedProxyIps(env.RATE_LIMIT_TRUSTED_PROXY_IPS);
  } catch {
    failures.push("RATE_LIMIT_TRUSTED_PROXY_IPS must be a comma-separated list of valid IP addresses.");
  }
  if (trustedProxyHops > 0 && trustedProxyIps.length === 0) {
    failures.push("RATE_LIMIT_TRUSTED_PROXY_IPS is required when proxy hops are trusted.");
  }

  const origins = String(env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (String(env.NODE_ENV || "").toLowerCase() === "production" && origins.length === 0) {
    failures.push("Production requires explicit HTTPS CORS_ORIGINS.");
  }
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      failures.push("CORS_ORIGINS chứa origin không hợp lệ.");
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.pathname !== "/" ||
        parsed.search || parsed.hash || parsed.username || parsed.password) {
      failures.push("CORS_ORIGINS chỉ được chứa origin HTTP(S), không path/query/credential.");
    }
    if (String(env.NODE_ENV || "").toLowerCase() === "production" && parsed.protocol !== "https:") {
      failures.push("Production CORS_ORIGINS must use HTTPS.");
    }
  }

  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    const sepayConfig = normalizeSePayConfig({
      apiKey: env.SEPAY_API_KEY,
      bankCode: env.SEPAY_BANK_CODE,
      bankName: env.SEPAY_BANK_NAME,
      accountNumber: env.SEPAY_ACCOUNT_NUMBER,
      accountName: env.SEPAY_ACCOUNT_NAME,
    });
    if (!sepayConfig.valid) {
      failures.push(`Production requires valid SePay settings: ${sepayConfig.invalid.join(", ")}.`);
    }
  }

  const migrationsDirectory = path.join(__dirname, "..", "data", "migrations");
  const filenames = fs.readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort();
  const versions = filenames.map((filename) => filename.slice(0, filename.indexOf("_")));
  if (new Set(versions).size !== versions.length) {
    failures.push("Migration có version trùng nhau.");
  }
  for (let index = 1; index < versions.length; index += 1) {
    if (Number(versions[index]) <= Number(versions[index - 1])) {
      failures.push("Migration phải có version tăng dần duy nhất.");
      break;
    }
  }

  const isolationCheck = validateDatabaseEnvironmentIsolation(env);
  if (!isolationCheck.ok) {
    failures.push(...isolationCheck.errors);
  }

  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageLockPath = path.join(__dirname, "..", "package-lock.json");
  if (!fs.existsSync(packageLockPath)) {
    failures.push("package-lock.json is required so production dependencies can be installed reproducibly.");
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const lock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
      if (lock.lockfileVersion < 2 || lock.packages?.[""]?.name !== manifest.name ||
          JSON.stringify(lock.packages?.[""]?.dependencies || {}) !== JSON.stringify(manifest.dependencies || {}) ||
          JSON.stringify(lock.packages?.[""]?.devDependencies || {}) !== JSON.stringify(manifest.devDependencies || {})) {
        failures.push("package-lock.json must be current and match package.json before release.");
      }
    } catch {
      failures.push("package.json and package-lock.json must be valid JSON release manifests.");
    }
  }

  const dockerfilePath = path.join(__dirname, "..", "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) {
    failures.push("Dockerfile is required for the production container security checks.");
  } else {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    if (!/^\s*USER\s+(?!0(?:\s|$)|root(?:\s|$))\S+/im.test(dockerfile)) {
      failures.push("Dockerfile must run the application as a non-root user.");
    }
    if (!/npm\s+ci\s+--omit=dev\b/.test(dockerfile)) {
      failures.push("Dockerfile must install production dependencies from the lockfile with npm ci --omit=dev.");
    }
  }

  if (failures.length) {
    throw new Error(failures.join(" "));
  }
  return {
    productionCredentials: String(env.NODE_ENV || "").toLowerCase() !== "production" ||
      Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD),
    databaseConfigured: String(env.NODE_ENV || "").toLowerCase() !== "production" ||
      Boolean(env.DATABASE_URL),
    sepayPaymentConfigured: String(env.NODE_ENV || "").toLowerCase() !== "production" ||
      normalizeSePayConfig({
        apiKey: env.SEPAY_API_KEY,
        bankCode: env.SEPAY_BANK_CODE,
        bankName: env.SEPAY_BANK_NAME,
        accountNumber: env.SEPAY_ACCOUNT_NUMBER,
        accountName: env.SEPAY_ACCOUNT_NAME,
      }).valid,
    corsOrigins: origins.length,
    migrationCount: filenames.length,
    dependencyLockfileValid: fs.existsSync(packageLockPath),
    containerRunsAsNonRoot: fs.existsSync(dockerfilePath),
  };
}

if (require.main === module) {
  try {
    const result = assertProductionEnvironment();
    console.log(JSON.stringify({ event: "predeploy_check_passed", ...result }));
  } catch (error) {
    console.error(`Pre-deploy check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertProductionEnvironment };
