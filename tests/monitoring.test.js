const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const {
  MonitoringMetrics,
  normalizeRequestRoute,
  redactLogText,
} = require("../backend/monitoring");

test("monitoring aggregates API latency and errors without retaining sensitive route values", () => {
  let now = 1_000;
  const metrics = new MonitoringMetrics({ clock: () => now });
  const customerId = "f1ea7a68-b289-48a8-88d0-2954db036425";
  assert.equal(
    normalizeRequestRoute(`/api/admin/customers/${customerId}?email=private@example.test`),
    "/api/admin/customers",
  );
  assert.equal(normalizeRequestRoute("/assets/private-file.svg"), "/<static>");

  metrics.recordRequest({
    method: "GET",
    pathname: `/api/orders/${customerId}`,
    status: 200,
    durationMs: 120,
  });
  for (let index = 0; index < 5; index += 1) {
    now += 100;
    metrics.recordRequest({
      method: "POST",
      pathname: "/api/orders",
      status: 500,
      durationMs: 200 + index,
    });
  }
  metrics.recordRequest({
    method: "GET",
    pathname: "/admin.html",
    status: 200,
    durationMs: 10_000,
  });

  const snapshot = metrics.getSnapshot(now);
  assert.equal(snapshot.totalRequests, 7);
  assert.equal(snapshot.requestsLast5m, 6);
  assert.equal(snapshot.serverErrorsLast5m, 5);
  assert.equal(snapshot.errorRatePct, 83.33);
  assert.equal(snapshot.p95LatencyMs, 204);
  assert.equal(snapshot.routes.some((route) => route.route.includes(customerId)), false);
  assert.equal(metrics.getTriggeredAlerts(now)[0].event, "api_server_error_threshold");
  assert.equal(metrics.shouldSendAlert("api_server_error_threshold", now), true);
  assert.equal(metrics.shouldSendAlert("api_server_error_threshold", now + 1000), false);
  assert.equal(metrics.shouldSendAlert("api_server_error_threshold", now + 900_000), true);
});

test("monitoring detects readiness, payment webhook, and order conflict thresholds", () => {
  const metrics = new MonitoringMetrics();
  for (let index = 0; index < 3; index += 1) {
    metrics.recordRequest({
      method: "POST",
      pathname: "/api/payments/webhook",
      status: index === 0 ? 500 : 409,
      durationMs: 10,
    });
    metrics.recordRequest({
      method: "POST",
      pathname: "/api/orders",
      status: 409,
      durationMs: 10,
    });
  }
  for (let index = 0; index < 2; index += 1) {
    metrics.recordRequest({
      method: "POST",
      pathname: "/api/payments/webhook",
      status: 500,
      durationMs: 10,
    });
  }
  metrics.recordRequest({
    method: "GET",
    pathname: "/ready",
    status: 503,
    durationMs: 10,
  });
  metrics.recordPaymentWebhookDuplicate();

  const alertEvents = metrics.getTriggeredAlerts().map((alert) => alert.event);
  assert.ok(alertEvents.includes("database_readiness_failed"));
  assert.ok(alertEvents.includes("payment_webhook_threshold"));
  assert.ok(alertEvents.includes("order_idempotency_conflict_threshold"));
  const snapshot = metrics.getSnapshot();
  assert.equal(snapshot.payments.webhookConflictsLast5m, 2);
  assert.equal(snapshot.payments.duplicatesSinceStart, 1);
});

test("log redaction removes configured secrets, credentials, email and phone values", () => {
  const requestId = "2f9849db-8ef0-4165-8e95-7c1330e723e1";
  const message = redactLogText(
    `password=secret-pass Bearer abc123 database postgres://db-user:private-pass@db.test/store contact user@example.test 0901234567 server 127.0.0.1:5432 requestId=${requestId}`,
    { ADMIN_PASSWORD: "secret-pass" },
  );
  assert.doesNotMatch(message, /secret-pass|abc123|private-pass|user@example\.test|0901234567/);
  assert.match(message, /\[REDACTED\]/);
  assert.match(message, /\[REDACTED_EMAIL\]/);
  assert.match(message, /\[REDACTED_PHONE\]/);
  assert.match(message, /127\.0\.0\.1:5432/);
  assert.ok(message.includes(requestId));
});

test("runtime monitoring sends sanitized API, database, and payment alerts", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-monitoring-alerts-"));
  const alertPayloads = [];
  const database = {
    async init() { throw new Error("database credentials unavailable"); },
    async getCustomBooks() { return []; },
  };
  const server = createServer({
    database,
    backupStatusFile: path.join(directory, "backup-status.json"),
    paymentWebhookSecret: "",
    monitoringAlertUrl: "https://alerts.example.test/hook",
    monitoringAlertFetch: async (_url, options) => {
      alertPayloads.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const readiness = await fetch(`${baseUrl}/ready`);
  assert.equal(readiness.status, 503);
  for (let index = 0; index < 5; index += 1) {
    const response = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
  }
  for (let attempt = 0; attempt < 20 && alertPayloads.length < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const events = new Set(alertPayloads.map((payload) => payload.event));
  assert.ok(events.has("database_readiness_failed"));
  assert.ok(events.has("payment_webhook_threshold"));
  assert.ok(events.has("api_server_error_threshold"));
  assert.ok(alertPayloads.every((payload) => typeof payload.requestId === "string"));
  assert.doesNotMatch(JSON.stringify(alertPayloads), /credentials unavailable|Bearer |private@example/);
});

test("runtime monitoring alerts when requests are waiting for PostgreSQL pool connections", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-pool-alert-"));
  const alertPayloads = [];
  const server = createServer({
    database: {
      async init() {},
      async getCustomBooks() { return []; },
      async getMonitoringStatus() {
        return {
          status: "healthy",
          storage: "postgresql",
          connections: { total: 10, active: 10, idle: 0, waiting: 2 },
        };
      },
    },
    backupStatusFile: path.join(directory, "backup-status.json"),
    paymentWebhookSecret: "",
    monitoringAlertUrl: "https://alerts.example.test/hook",
    monitoringAlertFetch: async (_url, options) => {
      alertPayloads.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/ready`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.deepEqual(status.connections, { total: 10, active: 10, idle: 0, waiting: 2 });
  for (let attempt = 0; attempt < 20 && alertPayloads.length < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(alertPayloads[0].event, "database_pool_waiting_clients");
  assert.equal(alertPayloads[0].count, 2);
});
