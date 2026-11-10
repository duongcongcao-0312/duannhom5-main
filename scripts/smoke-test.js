const process = require("node:process");

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMOKE_BASE_URL phải là URL HTTP(S) hợp lệ.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SMOKE_BASE_URL phải dùng HTTP(S) và không nhúng thông tin đăng nhập.");
  }
  return url.origin;
}

function parseTimeout(value) {
  const timeoutMs = value === undefined || value === "" ? 5000 : Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("SMOKE_TIMEOUT_MS phải là số nguyên từ 1 đến 120000.");
  }
  return timeoutMs;
}

function parseAlertUrl(value) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMOKE_ALERT_WEBHOOK_URL không phải URL hợp lệ.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("SMOKE_ALERT_WEBHOOK_URL phải dùng HTTPS và không nhúng thông tin đăng nhập.");
  }
  return value;
}

async function postAlert(alertUrl, payload, fetchImpl, timeoutMs, errorLog) {
  if (!alertUrl) return;
  try {
    const response = await fetchImpl(alertUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Alert endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    errorLog(JSON.stringify({
      event: "monitoring_alert_failed",
      message: error.message,
    }));
  }
}

async function runSmokeChecks(options = {}) {
  const baseUrl = parseBaseUrl(options.baseUrl || process.env.SMOKE_BASE_URL || "http://127.0.0.1:8000");
  const timeoutMs = options.timeoutMs === undefined
    ? parseTimeout(process.env.SMOKE_TIMEOUT_MS)
    : parseTimeout(options.timeoutMs);
  const alertWebhookUrl = parseAlertUrl(options.alertWebhookUrl || process.env.SMOKE_ALERT_WEBHOOK_URL || "");
  const fetchImpl = options.fetch || globalThis.fetch;
  const output = options.log || console.log;
  const errorOutput = options.errorLog || console.error;
  const results = [];

  async function check(name, route, requestOptions, expectedStatus, expectedBody) {
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(new URL(route, `${baseUrl}/`), {
        ...requestOptions,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let body;
      if (expectedBody) {
        try {
          body = await response.json();
        } catch {
          body = null;
        }
      }
      const result = {
        name,
        path: route,
        status: response.status,
        expectedStatus,
        durationMs: Date.now() - startedAt,
        requestId: response.headers.get("x-request-id") || undefined,
        ok: response.status === expectedStatus &&
          (!expectedBody || Object.entries(expectedBody).every(([key, value]) => body?.[key] === value)),
      };
      if (!result.ok && expectedBody) result.expectedBody = expectedBody;
      results.push(result);
      (result.ok ? output : errorOutput)(JSON.stringify(result));
    } catch (error) {
      const result = {
        name,
        path: route,
        expectedStatus,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: String(error.message || "Request failed").replaceAll(baseUrl, "[SMOKE_BASE_URL]"),
      };
      results.push(result);
      errorOutput(JSON.stringify(result));
    }
  }

  await check("liveness", "/health", {}, 200, { status: "ok", service: "booknest" });
  await check("readiness", "/ready", {}, 200, { status: "ready", service: "booknest" });
  await check("frontend", "/", {}, 200);
  await check("books-api", "/api/books", {}, 200);
  await check("auth-session-required", "/api/auth/me", {}, 401);
  await check("admin-api-auth-required", "/api/admin/stats", {}, 401);

  const failed = results.filter((result) => !result.ok);
  output(JSON.stringify({
    event: "smoke_test_complete",
    baseUrl,
    checks: results.length,
    failed: failed.length,
    passed: failed.length === 0,
  }));
  if (failed.length > 0) {
    await postAlert(
      alertWebhookUrl,
      {
        event: "monitoring_check_failed",
        timestamp: new Date().toISOString(),
        baseUrl,
        failed,
        text: `BookNest monitoring failed: ${failed.map((result) => result.name).join(", ")}.`,
        content: `BookNest monitoring failed: ${failed.map((result) => result.name).join(", ")}.`,
      },
      fetchImpl,
      timeoutMs,
      errorOutput,
    );
    return false;
  }
  return true;
}

async function main() {
  const passed = await runSmokeChecks();
  if (!passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "smoke_test_failed", error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { parseAlertUrl, parseBaseUrl, parseTimeout, runSmokeChecks };
