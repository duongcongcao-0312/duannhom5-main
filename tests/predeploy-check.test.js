const assert = require("node:assert/strict");
const test = require("node:test");
const { assertProductionEnvironment } = require("../scripts/predeploy-check");

test("pre-deploy check accepts explicit CORS origins and ordered migrations", () => {
  const result = assertProductionEnvironment({
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    ADMIN_PASSWORD: "password1234",
    CORS_ORIGINS: "https://shop.example,https://admin.example",
    DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
  });
  assert.equal(result.corsOrigins, 2);
  assert.ok(result.migrationCount >= 1);
});

test("pre-deploy check rejects unsafe CORS origins without exposing values", () => {
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "password1234",
      CORS_ORIGINS: "https://shop.example/app",
      DATABASE_URL: "postgresql://deploy:secret@db.example.com:5432/booknest",
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
    }),
    /DATABASE_URL/,
  );
});
