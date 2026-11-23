"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {
  assertDatabaseEnvironmentIsolation,
  assertSeedAllowed,
  validateDatabaseEnvironmentIsolation,
} = require("../backend/env-isolation");
const { assertProductionEnvironment } = require("../scripts/predeploy-check");

test("blocks development, test, and staging from connecting to production databases without leaking credentials", () => {
  const secretPass = "SuperSecretProdDbPassword999";
  for (const envName of ["development", "test", "staging"]) {
    const result = validateDatabaseEnvironmentIsolation({
      APP_ENV: envName,
      NODE_ENV: envName === "staging" ? "production" : envName,
      DATABASE_URL: `postgresql://app:${secretPass}@db.prod.example.com:5432/booknest_prod`,
    });
    assert.equal(result.ok, false, `${envName} must be blocked from prod DB`);
    const joined = result.errors.join(" ");
    assert.match(joined, /production/i);
    assert.ok(!joined.includes(secretPass), "error message must never leak DB password");
  }
});

test("blocks production from connecting to localhost or dev/staging/test databases", () => {
  const localProd = validateDatabaseEnvironmentIsolation({
    APP_ENV: "production",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@localhost:5432/booknest_prod",
  });
  assert.equal(localProd.ok, false);

  const stagingDbInProd = validateDatabaseEnvironmentIsolation({
    APP_ENV: "production",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@db.example.com:5432/booknest_staging",
  });
  assert.equal(stagingDbInProd.ok, false);

  const mismatchExpected = validateDatabaseEnvironmentIsolation({
    APP_ENV: "production",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@db.example.com:5432/booknest_other",
    EXPECTED_DATABASE_NAME: "booknest_prod",
  });
  assert.equal(mismatchExpected.ok, false);
});

test("allows properly isolated development, staging, and production database configs", () => {
  assert.equal(
    assertDatabaseEnvironmentIsolation({
      APP_ENV: "development",
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://dev:pw@localhost:5432/booknest_dev",
      EXPECTED_DATABASE_NAME: "booknest_dev",
    }).ok,
    true,
  );
  assert.equal(
    assertDatabaseEnvironmentIsolation({
      APP_ENV: "staging",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://stg:pw@staging-db.example.com:5432/booknest_staging",
      EXPECTED_DATABASE_NAME: "booknest_staging",
    }).ok,
    true,
  );
  assert.equal(
    assertDatabaseEnvironmentIsolation({
      APP_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://prod:pw@prod-db.example.com:5432/booknest_prod",
      EXPECTED_DATABASE_NAME: "booknest_prod",
    }).ok,
    true,
  );
});

test("requires a pinned database name and production runtime mode for hosted environments", () => {
  const stagingWithoutPin = validateDatabaseEnvironmentIsolation({
    APP_ENV: "staging",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://staging:pw@staging-db.example.com:5432/booknest_staging",
  });
  assert.equal(stagingWithoutPin.ok, false);
  assert.match(stagingWithoutPin.errors.join(" "), /EXPECTED_DATABASE_NAME/);

  const productionWithoutPin = validateDatabaseEnvironmentIsolation({
    APP_ENV: "production",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://production:pw@db.example.com:5432/booknest_prod",
  });
  assert.equal(productionWithoutPin.ok, false);
  assert.match(productionWithoutPin.errors.join(" "), /EXPECTED_DATABASE_NAME/);

  const unsafeStagingMode = validateDatabaseEnvironmentIsolation({
    APP_ENV: "staging",
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://staging:pw@staging-db.example.com:5432/booknest_staging",
    EXPECTED_DATABASE_NAME: "booknest_staging",
  });
  assert.equal(unsafeStagingMode.ok, false);
  assert.match(unsafeStagingMode.errors.join(" "), /NODE_ENV=production/);
});

test("assertSeedAllowed blocks seeding in production or against production DATABASE_URL and allows dev/test", () => {
  assert.throws(
    () => assertSeedAllowed({ NODE_ENV: "production", DATABASE_URL: "postgresql://p:s@db.example.com:5432/booknest_prod" }),
    /production/i,
  );
  assert.throws(
    () => assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "postgresql://p:s@db.prod.example.com:5432/booknest_prod" }),
    /production/i,
  );
  assert.equal(
    assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "postgresql://d:s@localhost:5432/booknest_dev" }).ok,
    true,
  );
});

test("predeploy-check rejects production deployment pointing at a staging database and isolation doc exists", async () => {
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      APP_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "Strong-Deploy-Password!2026",
      CORS_ORIGINS: "https://shop.example",
      DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest_staging",
      RATE_LIMIT_HMAC_KEY: "synthetic-rate-limit-hmac-secret-for-tests",
      SEPAY_API_KEY: "synthetic-sepay-api-key",
      SEPAY_BANK_CODE: "970415",
      SEPAY_BANK_NAME: "Test Bank",
      SEPAY_ACCOUNT_NUMBER: "123456789012",
      SEPAY_ACCOUNT_NAME: "BookNest Test",
    }),
    /dev\/staging\/test/i,
  );

  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "environment-data-isolation.md"), "utf8");
  assert.match(doc, /development/i);
  assert.match(doc, /staging/i);
  assert.match(doc, /production/i);
  assert.match(doc, /EXPECTED_DATABASE_NAME/);
});
