"use strict";

const ALLOWED_ENVIRONMENTS = Object.freeze(["development", "test", "staging", "production"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PROD_MARKER_PATTERN = /(?:^|[-_.])(prod|production)(?:$|[-_.])/i;
const NON_PROD_MARKER_PATTERN = /(?:^|[-_.])(dev|development|staging|stage|test|local)(?:$|[-_.])/i;
const DEV_TEST_MARKER_PATTERN = /(?:^|[-_.])(dev|development|test|local)(?:$|[-_.])/i;

function resolveAppEnvironment(env = process.env) {
  const rawAppEnv = String(env.APP_ENV || "").trim().toLowerCase();
  if (rawAppEnv) {
    if (!ALLOWED_ENVIRONMENTS.includes(rawAppEnv)) {
      throw new Error(
        `APP_ENV "${rawAppEnv}" không hợp lệ. Chỉ chấp nhận: ${ALLOWED_ENVIRONMENTS.join(", ")}.`,
      );
    }
    return rawAppEnv;
  }
  const rawNodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (ALLOWED_ENVIRONMENTS.includes(rawNodeEnv)) {
    return rawNodeEnv;
  }
  return "development";
}

function parseDatabaseTarget(databaseUrl) {
  if (!databaseUrl || !String(databaseUrl).trim()) {
    return null;
  }
  try {
    const parsed = new URL(String(databaseUrl).trim());
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("/")[0] || "");
    return {
      hostname: parsed.hostname.toLowerCase(),
      databaseName,
    };
  } catch {
    return null;
  }
}

function validateDatabaseEnvironmentIsolation(env = process.env) {
  const errors = [];
  let environment;
  try {
    environment = resolveAppEnvironment(env);
  } catch (error) {
    return { ok: false, environment: null, databaseName: "", hostname: "", errors: [error.message] };
  }

  const rawNodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (environment === "staging" && rawNodeEnv && rawNodeEnv !== "production") {
    errors.push("APP_ENV=staging must use NODE_ENV=production for the production runtime safeguards.");
  }
  if (environment === "production" && rawNodeEnv && rawNodeEnv !== "production") {
    errors.push("APP_ENV=production không được chạy với NODE_ENV khác production.");
  }

  const target = parseDatabaseTarget(env.DATABASE_URL);
  if (target) {
    const { hostname, databaseName } = target;
    const expectedDbName = String(env.EXPECTED_DATABASE_NAME || "").trim();
    if ((environment === "staging" || environment === "production") && !expectedDbName) {
      errors.push(`APP_ENV=${environment} requires EXPECTED_DATABASE_NAME to pin the database target.`);
    }
    if (expectedDbName && databaseName !== expectedDbName) {
      errors.push(
        `DATABASE_URL trỏ tới database "${databaseName}" không khớp EXPECTED_DATABASE_NAME ("${expectedDbName}").`,
      );
    }

    if (environment === "production") {
      if (LOCAL_HOSTNAMES.has(hostname) && String(env.ALLOW_LOCAL_PROD_DB || "").toLowerCase() !== "true") {
        errors.push("Môi trường production không được phép kết nối database localhost/127.0.0.1.");
      }
      if (NON_PROD_MARKER_PATTERN.test(databaseName)) {
        errors.push(
          `Môi trường production không được dùng database dành cho dev/staging/test ("${databaseName}").`,
        );
      }
    } else if (environment === "staging") {
      if (PROD_MARKER_PATTERN.test(databaseName) || PROD_MARKER_PATTERN.test(hostname)) {
        errors.push(
          "Môi trường staging bị chặn kết nối tới database/host production để tránh ghi nhầm dữ liệu.",
        );
      }
      if (LOCAL_HOSTNAMES.has(hostname) || DEV_TEST_MARKER_PATTERN.test(databaseName)) {
        errors.push(
          `Môi trường staging không được dùng database localhost/dev/test ("${databaseName || hostname}").`,
        );
      }
    } else {
      // development or test
      if (PROD_MARKER_PATTERN.test(databaseName) || PROD_MARKER_PATTERN.test(hostname)) {
        errors.push(
          `Môi trường ${environment} bị chặn kết nối tới database/host production để tránh ghi nhầm dữ liệu.`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    environment,
    databaseName: target?.databaseName || "",
    hostname: target?.hostname || "",
    errors,
  };
}

function assertDatabaseEnvironmentIsolation(env = process.env) {
  const result = validateDatabaseEnvironmentIsolation(env);
  if (!result.ok) {
    throw new Error(result.errors.join(" "));
  }
  return result;
}

function assertSeedAllowed(env = process.env) {
  const result = assertDatabaseEnvironmentIsolation(env);
  if (result.environment === "production") {
    throw new Error("Không được phép chạy script seed dữ liệu mẫu trên môi trường production.");
  }
  if (
    PROD_MARKER_PATTERN.test(result.databaseName) ||
    PROD_MARKER_PATTERN.test(result.hostname)
  ) {
    throw new Error("Chặn chạy seed vì DATABASE_URL trỏ tới database/host production.");
  }
  return result;
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  assertDatabaseEnvironmentIsolation,
  assertSeedAllowed,
  parseDatabaseTarget,
  resolveAppEnvironment,
  validateDatabaseEnvironmentIsolation,
};
