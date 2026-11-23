const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const { parseLoadTestConfig, runLoadTest } = require("../scripts/load-test");

test("load test accepts a local URL and rejects remote targets without staging approval", () => {
  const local = parseLoadTestConfig({});
  assert.equal(local.baseUrl, "http://127.0.0.1:8000");

  assert.throws(
    () => parseLoadTestConfig({ LOAD_TEST_BASE_URL: "https://api.example.com" }),
    /local test URL or an explicitly allow-listed staging host/,
  );
  assert.throws(
    () => parseLoadTestConfig({
      LOAD_TEST_BASE_URL: "https://duannhom5-main.onrender.com",
      LOAD_TEST_ALLOW_STAGING: "true",
      LOAD_TEST_STAGING_HOSTS: "duannhom5-main.onrender.com",
    }),
    /local test URL or an explicitly allow-listed staging host/,
  );
  assert.throws(
    () => parseLoadTestConfig({
      LOAD_TEST_BASE_URL: "https://duannhom5-main.onrender.com.",
      LOAD_TEST_ALLOW_STAGING: "true",
      LOAD_TEST_STAGING_HOSTS: "duannhom5-main.onrender.com.",
    }),
    /local test URL or an explicitly allow-listed staging host/,
  );
});

test("load test allows only explicitly named non-production staging hosts", () => {
  const config = parseLoadTestConfig({
    LOAD_TEST_BASE_URL: "https://staging.example.test",
    LOAD_TEST_ALLOW_STAGING: "true",
    LOAD_TEST_STAGING_HOSTS: "staging.example.test",
  });
  assert.equal(config.baseUrl, "https://staging.example.test");
});

test("load test enforces bounded request and concurrency settings", () => {
  assert.throws(
    () => parseLoadTestConfig({ LOAD_TEST_REQUESTS: "501" }),
    /LOAD_TEST_REQUESTS/,
  );
  assert.throws(
    () => parseLoadTestConfig({
      LOAD_TEST_REQUESTS: "2",
      LOAD_TEST_CONCURRENCY: "3",
    }),
    /LOAD_TEST_CONCURRENCY/,
  );
});

test("load test reports latency percentiles and error rate using local read-only routes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-load-test-"));
  const database = new Database({ dataDir: directory });
  database.consumeRateLimit = async (_key, _limit, _windowMs, now = Date.now()) => ({
    allowed: true,
    resetAt: now + 60_000,
  });
  const server = createServer({ database });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const result = await runLoadTest({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requestCount: 60,
    concurrency: 6,
    timeoutMs: 5000,
    log: () => {},
  });

  assert.equal(result.requests, 60);
  assert.equal(result.failed, 0);
  assert.equal(result.errorRate, 0);
  assert.equal(result.statuses["200"], 60);
  assert.ok(result.latencyMs.p50 >= 0);
  assert.ok(result.latencyMs.p95 >= result.latencyMs.p50);
  assert.ok(result.latencyMs.p99 >= result.latencyMs.p95);
  assert.equal(result.slo.passed, true);
  assert.deepEqual(result.slo.breaches, []);
});
