const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createDatabasePoolConfig,
  createDatabaseSslConfig,
} = require("../backend/postgres-db");

test("PostgreSQL TLS trusts the configured CA while verifying the server", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-ca-test-"));
  const certificate = "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n";
  const certificatePath = path.join(directory, "supabase-ca.crt");
  await fs.writeFile(certificatePath, certificate);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  assert.deepEqual(createDatabaseSslConfig(certificatePath), {
    ca: certificate,
    rejectUnauthorized: true,
  });
});

test("PostgreSQL TLS keeps standard certificate verification without a custom CA", () => {
  assert.equal(createDatabaseSslConfig(""), true);
});

test("PostgreSQL TLS reports an unreadable configured CA", () => {
  assert.throws(
    () => createDatabaseSslConfig(path.join(os.tmpdir(), "missing-supabase-ca.crt")),
    /Không thể đọc CA certificate tại DATABASE_SSL_CA_PATH/,
  );
});

test("PostgreSQL TLS uses the supplied CA instead of URI SSL mode options", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-ca-uri-test-"));
  const certificate = "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n";
  const certificatePath = path.join(directory, "supabase-ca.crt");
  await fs.writeFile(certificatePath, certificate);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const config = createDatabasePoolConfig(
    "postgresql://db.example.test:5432/app?sslmode=require&application_name=booknest",
    certificatePath,
  );
  const parsedUrl = new URL(config.connectionString);

  assert.equal(parsedUrl.searchParams.has("sslmode"), false);
  assert.equal(parsedUrl.searchParams.get("application_name"), "booknest");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, certificate);
});
