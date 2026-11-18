const { defineConfig } = require("@playwright/test");
const {
  assertSafeE2eDatabaseUrl,
  E2E_PAYMENT_WEBHOOK_SECRET,
} = require("./scripts/e2e-config");

const baseURL = "http://127.0.0.1:8000";
const databaseUrl = assertSafeE2eDatabaseUrl(process.env.E2E_DATABASE_URL);

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  webServer: {
    command: "node server.js",
    url: `${baseURL}/ready`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PATHEXT: process.env.PATHEXT,
      PORT: "8000",
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADMIN_EMAIL: "e2e-admin@example.test",
      ADMIN_PASSWORD: "e2e-only-admin-password",
      PAYMENT_WEBHOOK_SECRET: E2E_PAYMENT_WEBHOOK_SECRET,
      SEPAY_API_KEY: "e2e-sepay-api-key-not-a-secret",
      SEPAY_BANK_CODE: "970415",
      SEPAY_BANK_NAME: "Test Bank",
      SEPAY_ACCOUNT_NUMBER: "1234567890",
      SEPAY_ACCOUNT_NAME: "BOOKNEST TEST",
    },
  },
});
