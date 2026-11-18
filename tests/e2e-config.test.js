const assert = require("node:assert/strict");
const test = require("node:test");
const { assertSafeE2eDatabaseUrl } = require("../scripts/e2e-config");

test("accepts only a loopback PostgreSQL URL whose database is marked for tests", () => {
  const url = "postgresql://booknest:test-password@localhost:5432/booknest_test";
  assert.equal(assertSafeE2eDatabaseUrl(url), url);
});

test("rejects production-like database URLs without exposing credentials", () => {
  const url = "postgresql://private-user:private-password@db.example.com:5432/booknest";
  assert.throws(
    () => assertSafeE2eDatabaseUrl(url),
    (error) => {
      assert.equal(error.message, "E2E_DATABASE_URL must target an isolated local test database.");
      assert.doesNotMatch(error.message, /private-user|private-password|db\.example/);
      return true;
    },
  );
});
