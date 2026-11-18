const assert = require("node:assert/strict");
const test = require("node:test");
const { assertProductionEnvironment } = require("../scripts/predeploy-check");

const validSePayConfig = {
  SEPAY_API_KEY: "synthetic-sepay-api-key",
  SEPAY_BANK_CODE: "970415",
  SEPAY_BANK_NAME: "Test Bank",
  SEPAY_ACCOUNT_NUMBER: "123456789012",
  SEPAY_ACCOUNT_NAME: "BookNest Test",
};
const validRateLimitKey = "synthetic-rate-limit-hmac-secret-for-tests";

test("pre-deploy check accepts explicit CORS origins and ordered migrations", () => {
  const result = assertProductionEnvironment({
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    ADMIN_PASSWORD: "password1234",
    CORS_ORIGINS: "https://shop.example,https://admin.example",
    DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
    RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    ...validSePayConfig,
  });
  assert.equal(result.corsOrigins, 2);
  assert.equal(result.sepayPaymentConfigured, true);
  assert.ok(result.migrationCount >= 1);
});

test("pre-deploy check rejects missing SePay production settings", () => {
  const productionEnvironment = {
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    ADMIN_PASSWORD: "password1234",
    CORS_ORIGINS: "https://shop.example",
    DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
    RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    ...validSePayConfig,
  };
  for (const setting of Object.keys(validSePayConfig)) {
    assert.throws(
      () => assertProductionEnvironment({ ...productionEnvironment, [setting]: "" }),
      new RegExp(setting),
    );
  }
});

test("pre-deploy check rejects malformed SePay values without exposing credentials", () => {
  const syntheticCredential = "synthetic-secret-value-not-a-real-credential";
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "password1234",
      CORS_ORIGINS: "https://shop.example",
      DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
      RATE_LIMIT_HMAC_KEY: validRateLimitKey,
      ...validSePayConfig,
      SEPAY_API_KEY: syntheticCredential,
      SEPAY_BANK_CODE: "TCB",
    }),
    (error) => {
      assert.match(error.message, /SEPAY_BANK_CODE/);
      assert.doesNotMatch(error.message, new RegExp(syntheticCredential));
      return true;
    },
  );
});

test("pre-deploy check rejects unsafe CORS origins without exposing values", () => {
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "password1234",
      CORS_ORIGINS: "https://shop.example/app",
      DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
      RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    }),
    /CORS_ORIGINS/,
  );
});

test("pre-deploy check requires at least 12 non-space admin password characters", () => {
  const env = {
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    CORS_ORIGINS: "https://shop.example",
    DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
    RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    ...validSePayConfig,
  };
  assert.throws(
    () => assertProductionEnvironment({ ...env, ADMIN_PASSWORD: "password123" }),
    /ADMIN_PASSWORD/,
  );
  assert.doesNotThrow(
    () => assertProductionEnvironment({ ...env, ADMIN_PASSWORD: "password1234" }),
  );
});

test("pre-deploy check requires a PostgreSQL DATABASE_URL in production", () => {
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "password1234",
      CORS_ORIGINS: "https://shop.example",
      RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    }),
    /DATABASE_URL/,
  );
});

test("pre-deploy check requires a long rate-limit HMAC key and valid trusted proxy hops", () => {
  const productionEnvironment = {
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    ADMIN_PASSWORD: "password1234",
    CORS_ORIGINS: "https://shop.example",
    DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
    RATE_LIMIT_HMAC_KEY: validRateLimitKey,
    ...validSePayConfig,
  };
  assert.throws(
    () => assertProductionEnvironment({
      ...productionEnvironment,
      RATE_LIMIT_HMAC_KEY: undefined,
    }),
    /RATE_LIMIT_HMAC_KEY/,
  );
  assert.throws(
    () => assertProductionEnvironment({ ...productionEnvironment, RATE_LIMIT_HMAC_KEY: "short" }),
    /RATE_LIMIT_HMAC_KEY/,
  );
  assert.throws(
    () => assertProductionEnvironment({
      ...productionEnvironment,
      RATE_LIMIT_TRUSTED_PROXY_HOPS: "-1",
    }),
    /RATE_LIMIT_TRUSTED_PROXY_HOPS/,
  );
  assert.throws(
    () => assertProductionEnvironment({
      ...productionEnvironment,
      RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
    }),
    /RATE_LIMIT_TRUSTED_PROXY_IPS/,
  );
  assert.throws(
    () => assertProductionEnvironment({
      ...productionEnvironment,
      RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
      RATE_LIMIT_TRUSTED_PROXY_IPS: "not-an-ip",
    }),
    /RATE_LIMIT_TRUSTED_PROXY_IPS/,
  );
  assert.doesNotThrow(() => assertProductionEnvironment({
    ...productionEnvironment,
    RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
    RATE_LIMIT_TRUSTED_PROXY_IPS: "10.0.0.4,2001:db8::4",
  }));
});
