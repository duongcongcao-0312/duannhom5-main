const E2E_PAYMENT_WEBHOOK_SECRET = "booknest-e2e-webhook-test-secret-32-bytes-minimum";

function assertSafeE2eDatabaseUrl(value) {
  const errorMessage = "E2E_DATABASE_URL must target an isolated local test database.";
  if (typeof value !== "string" || !value) throw new Error(errorMessage);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorMessage);
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error(errorMessage);
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const testDatabaseName = /(^|[-_])(test|e2e)([-_]|$)/i.test(databaseName);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !localHosts.has(url.hostname.toLowerCase()) ||
    !databaseName ||
    !testDatabaseName ||
    url.search ||
    url.hash
  ) {
    throw new Error(errorMessage);
  }

  return value;
}

module.exports = { assertSafeE2eDatabaseUrl, E2E_PAYMENT_WEBHOOK_SECRET };
