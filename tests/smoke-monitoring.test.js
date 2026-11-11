const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { parseBaseUrl, parseTimeout, runSmokeChecks } = require("../scripts/smoke-test");

test("smoke monitoring validates endpoint configuration and reports all expected checks", async () => {
  const paths = [];
  const logs = [];
  const successfulBodies = {
    "/health": { status: "ok", service: "booknest" },
    "/ready": { status: "ready", service: "booknest" },
    "/api/books": [],
  };
  const passed = await runSmokeChecks({
    baseUrl: "https://monitor.example.test/status/",
    timeoutMs: 2000,
    log: (message) => logs.push(message),
    errorLog: (message) => logs.push(message),
    fetch: async (url) => {
      paths.push(url.pathname);
      if (successfulBodies[url.pathname]) {
        return new Response(JSON.stringify(successfulBodies[url.pathname]), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Request-Id": "health-request-1" },
        });
      }
      if (url.pathname === "/") return new Response("BookNest", { status: 200 });
      return new Response("{}", {
        status: url.pathname === "/api/auth/me" || url.pathname === "/api/admin/stats" ? 401 : 400,
      });
    },
  });
  assert.equal(passed, true);
  assert.deepEqual(paths, [
    "/health",
    "/ready",
    "/",
    "/api/books",
    "/api/auth/me",
    "/api/admin/stats",
  ]);
  assert.match(logs[0], /"requestId":"health-request-1"/);
  assert.match(logs.at(-1), /"failed":0/);

  assert.throws(() => parseBaseUrl("https://user:password@example.test"), /không nhúng thông tin đăng nhập/);
  assert.equal(parseTimeout(undefined), 5000);
  assert.throws(() => parseTimeout("0"), /SMOKE_TIMEOUT_MS/);
});

test("smoke monitoring exposes readiness failures and sends a sanitized alert", async () => {
  const errors = [];
  const alertPayloads = [];
  const passed = await runSmokeChecks({
    baseUrl: "http://127.0.0.1:8000",
    alertWebhookUrl: "https://alerts.example.test/hook",
    log: () => {},
    errorLog: (message) => errors.push(message),
    fetch: async (requestUrl, options = {}) => {
      const url = new URL(requestUrl);
      if (url.pathname === "/ready") {
        return new Response(JSON.stringify({ status: "not_ready", service: "booknest" }), { status: 503 });
      }
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", service: "booknest" }), { status: 200 });
      }
      if (url.pathname === "/") return new Response("BookNest", { status: 200 });
      if (url.pathname === "/api/books") return new Response("[]", { status: 200 });
      if (url.pathname === "/api/auth/me" || url.pathname === "/api/admin/stats") {
        return new Response("{}", { status: 401 });
      }
      alertPayloads.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    },
  });
  assert.equal(passed, false);
  assert.match(errors[0], /"name":"readiness"/);
  assert.equal(alertPayloads.length, 1);
  assert.equal(alertPayloads[0].event, "monitoring_check_failed");
  assert.equal(alertPayloads[0].failed.length, 1);
});

async function startServer(database) {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-smoke-"));
  const server = createServer({ database });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { directory, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("health and readiness smoke paths return useful status without writes", async (t) => {
  const calls = [];
  let closeCalls = 0;
  const { directory, server, baseUrl } = await startServer({
    async init() { calls.push("init"); },
    async getCustomBooks() { return []; },
    async findUserByEmail() { return null; },
    async close() { closeCalls += 1; },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(closeCalls, 1);
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  assert.deepEqual(await health.json(), { status: "ok", service: "booknest" });
  const correlatedHealth = await fetch(`${baseUrl}/health`, {
    headers: { "X-Request-Id": "issue56-health-check" },
  });
  assert.equal(correlatedHealth.headers.get("x-request-id"), "issue56-health-check");
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready", service: "booknest" });
  assert.deepEqual(calls, ["init"]);
  assert.equal(await runSmokeChecks({
    baseUrl,
    log: () => {},
    errorLog: () => {},
  }), true);
  assert.deepEqual(await fsPromises.readdir(directory), []);
});

test("readiness returns 503 when persistence is unavailable", async (t) => {
  const { directory, server, baseUrl } = await startServer({
    async init() { throw new Error("database unavailable"); },
    async getCustomBooks() { return []; },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "not_ready", service: "booknest" });
});

test("health and readiness HEAD requests are status-only without a response body", async (t) => {
  const { directory, server, baseUrl } = await startServer({
    async init() { return undefined; },
    async getCustomBooks() { return []; },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/health`, { method: "HEAD" });
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "");

  const ready = await fetch(`${baseUrl}/ready`, { method: "HEAD" });
  assert.equal(ready.status, 200);
  assert.equal(await ready.text(), "");
});
