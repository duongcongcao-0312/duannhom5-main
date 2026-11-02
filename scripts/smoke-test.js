const process = require("node:process");

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const results = [];

async function check(name, path, options, expectedStatus) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, options);
    const result = {
      name,
      path,
      status: response.status,
      expectedStatus,
      durationMs: Date.now() - startedAt,
      ok: response.status === expectedStatus,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { name, path, expectedStatus, durationMs: Date.now() - startedAt, ok: false, error: error.message };
    results.push(result);
    console.error(JSON.stringify(result));
  }
}

async function main() {
  await check("liveness", "/health", {}, 200);
  await check("readiness", "/ready", {}, 200);
  await check("frontend", "/", {}, 200);
  await check("books-api", "/api/books", {}, 200);
  await check("login-failure-without-write", "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "smoke.invalid@example.invalid", password: "invalid-smoke-password" }),
  }, 401);
  await check("register-validation-without-write", "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "invalid", password: "short" }),
  }, 400);

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ event: "smoke_test_complete", baseUrl, checks: results.length, failed: failed.length, passed: failed.length === 0 }));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "smoke_test_failed", error: error.message }));
  process.exitCode = 1;
});
