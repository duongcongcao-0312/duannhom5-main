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

test("PostgreSQL pool applies bounded connection and query timeouts", () => {
  const config = createDatabasePoolConfig("postgresql://db.example.test:5432/app", "");

  assert.equal(config.max, 10);
  assert.equal(config.idleTimeoutMillis, 30_000);
  assert.equal(config.maxLifetimeSeconds, 1_800);
  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.equal(config.statement_timeout, 10_000);
  assert.equal(config.query_timeout, 10_000);
});

test("PostgreSQL pool limits can be tuned per process and reject invalid values", (t) => {
  const names = ["PG_POOL_MAX", "PG_POOL_IDLE_TIMEOUT_MS", "PG_POOL_MAX_LIFETIME_SECONDS"];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
  process.env.PG_POOL_MAX = "4";
  process.env.PG_POOL_IDLE_TIMEOUT_MS = "12000";
  process.env.PG_POOL_MAX_LIFETIME_SECONDS = "600";
  const config = createDatabasePoolConfig("postgresql://db.example.test:5432/app", "");
  assert.equal(config.max, 4);
  assert.equal(config.idleTimeoutMillis, 12_000);
  assert.equal(config.maxLifetimeSeconds, 600);

  process.env.PG_POOL_MAX = "0";
  assert.throws(
    () => createDatabasePoolConfig("postgresql://db.example.test:5432/app", ""),
    /PG_POOL_MAX must be a positive integer/,
  );
});

test("PostgreSQL pool disables TLS only for loopback database hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(
      createDatabasePoolConfig(`postgresql://app:secret@${host}:5432/app`, "").ssl,
      false,
    );
  }
  assert.equal(
    createDatabasePoolConfig("postgresql://db.example.test:5432/app", "").ssl,
    true,
  );
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
