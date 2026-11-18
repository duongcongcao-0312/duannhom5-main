const fs = require("node:fs");
const path = require("node:path");
const { normalizeSePayConfig } = require("../backend/sepay-config");

function assertProductionEnvironment(env = process.env) {
  const failures = [];
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
