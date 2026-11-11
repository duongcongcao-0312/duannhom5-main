const assert = require("node:assert/strict");
const test = require("node:test");
const { assertProductionEnvironment } = require("../scripts/predeploy-check");

test("pre-deploy check accepts explicit CORS origins and ordered migrations", () => {
  const result = assertProductionEnvironment({
    NODE_ENV: "production",
    ADMIN_EMAIL: "deploy@example.com",
    ADMIN_PASSWORD: "safe-production-password",
    CORS_ORIGINS: "https://shop.example,https://admin.example",
  });
  assert.equal(result.corsOrigins, 2);
  assert.ok(result.migrationCount >= 1);
});

test("pre-deploy check rejects unsafe CORS origins without exposing values", () => {
  assert.throws(
    () => assertProductionEnvironment({
      NODE_ENV: "production",
      ADMIN_EMAIL: "deploy@example.com",
      ADMIN_PASSWORD: "safe-production-password",
      CORS_ORIGINS: "https://shop.example/app",
    }),
    /CORS_ORIGINS/,
  );
});
