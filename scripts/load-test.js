const productionHosts = new Set([
  "duongcongcao-0312.github.io",
  "duannhom5-main.onrender.com",
]);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const defaultRequestCount = 20;
const defaultConcurrency = 4;
const defaultTimeoutMs = 5000;
const maximumRequestCount = 500;
const maximumConcurrency = 20;
const maximumTimeoutMs = 60000;
const defaultSlo = Object.freeze({ p95LatencyMs: 1000, errorRate: 0.01, throughputRequestsPerSecond: 5 });
const scenarios = [
  { name: "browse", path: "/", method: "GET" },
  { name: "catalog_search_data", path: "/api/books?page=1&limit=10&sort=title&order=asc", method: "GET" },
  {
    name: "cart_quote",
    path: "/api/orders/quote",
    method: "POST",
    body: JSON.stringify({ items: [{ title: "Nhà giả kim", quantity: 1 }] }),
  },
  {
    name: "checkout_quote",
    path: "/api/orders/quote",
    method: "POST",
    body: JSON.stringify({ items: [{ title: "Nhà giả kim", quantity: 1 }] }),
  },
  { name: "api_health", path: "/health", method: "GET" },
  { name: "api_categories", path: "/api/categories", method: "GET" },
];

function parseBoundedInteger(value, defaultValue, minimum, maximum, name) {
  const parsed = value === undefined || value === ""
    ? defaultValue
    : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseLoadTestConfig(env = process.env) {
  const rawUrl = env.LOAD_TEST_BASE_URL || "http://127.0.0.1:8000";
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("LOAD_TEST_BASE_URL must be a local test URL or an explicitly allow-listed staging host.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isLocal = localHosts.has(hostname);
  const stagingHosts = new Set(
    String(env.LOAD_TEST_STAGING_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
  const explicitlyAllowedStaging = env.LOAD_TEST_ALLOW_STAGING === "true" &&
    stagingHosts.has(hostname) &&
    !productionHosts.has(hostname);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!isLocal && !explicitlyAllowedStaging)
  ) {
    throw new Error("LOAD_TEST_BASE_URL must be a local test URL or an explicitly allow-listed staging host.");
  }

  const requestCount = parseBoundedInteger(
    env.LOAD_TEST_REQUESTS,
    defaultRequestCount,
    1,
    maximumRequestCount,
    "LOAD_TEST_REQUESTS",
  );
  const concurrency = parseBoundedInteger(
    env.LOAD_TEST_CONCURRENCY,
    defaultConcurrency,
    1,
    maximumConcurrency,
    "LOAD_TEST_CONCURRENCY",
  );
  const timeoutMs = parseBoundedInteger(
    env.LOAD_TEST_TIMEOUT_MS,
    defaultTimeoutMs,
    1,
    maximumTimeoutMs,
    "LOAD_TEST_TIMEOUT_MS",
  );
  if (concurrency > requestCount) {
    throw new Error("LOAD_TEST_CONCURRENCY cannot exceed LOAD_TEST_REQUESTS.");
  }

  const slo = {
    p95LatencyMs: parseBoundedInteger(env.LOAD_TEST_SLO_P95_MS, defaultSlo.p95LatencyMs, 1, maximumTimeoutMs, "LOAD_TEST_SLO_P95_MS"),
    errorRate: env.LOAD_TEST_SLO_ERROR_RATE === undefined || env.LOAD_TEST_SLO_ERROR_RATE === ""
      ? defaultSlo.errorRate
      : Number(env.LOAD_TEST_SLO_ERROR_RATE),
    throughputRequestsPerSecond: env.LOAD_TEST_SLO_THROUGHPUT_RPS === undefined || env.LOAD_TEST_SLO_THROUGHPUT_RPS === ""
      ? defaultSlo.throughputRequestsPerSecond
      : Number(env.LOAD_TEST_SLO_THROUGHPUT_RPS),
  };
  if (!Number.isFinite(slo.errorRate) || slo.errorRate < 0 || slo.errorRate > 1) {
    throw new Error("LOAD_TEST_SLO_ERROR_RATE must be a number from 0 to 1.");
  }
  if (!Number.isFinite(slo.throughputRequestsPerSecond) || slo.throughputRequestsPerSecond <= 0) {
    throw new Error("LOAD_TEST_SLO_THROUGHPUT_RPS must be a positive number.");
  }

  return {
    baseUrl: url.origin,
    requestCount,
    concurrency,
    timeoutMs,
    slo,
  };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function runLoadTest(options = {}) {
  const config = parseLoadTestConfig({
    ...process.env,
    ...(options.env || {}),
    ...(options.baseUrl ? { LOAD_TEST_BASE_URL: options.baseUrl } : {}),
    ...(options.requestCount === undefined
      ? {}
      : { LOAD_TEST_REQUESTS: String(options.requestCount) }),
    ...(options.concurrency === undefined
      ? {}
      : { LOAD_TEST_CONCURRENCY: String(options.concurrency) }),
    ...(options.timeoutMs === undefined
      ? {}
      : { LOAD_TEST_TIMEOUT_MS: String(options.timeoutMs) }),
  });
  const fetchImpl = options.fetch || globalThis.fetch;
  const output = options.log || console.log;
  const results = [];
  let nextRequest = 0;

  async function runWorker() {
    while (nextRequest < config.requestCount) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      const scenario = scenarios[requestIndex % scenarios.length];
      const startedAt = performance.now();
      const result = {
        scenario: scenario.name,
        path: scenario.path,
        durationMs: 0,
        ok: false,
      };

      try {
        const response = await fetchImpl(new URL(scenario.path, `${config.baseUrl}/`), {
          method: scenario.method,
          ...(scenario.body
            ? {
              headers: { "Content-Type": "application/json" },
              body: scenario.body,
            }
            : {}),
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        await response.arrayBuffer();
        result.status = response.status;
        result.ok = response.status >= 200 && response.status < 300;
      } catch (error) {
        result.error = error?.name || "RequestError";
      }

      result.durationMs = performance.now() - startedAt;
      results.push(result);
    }
  }

  const runStartedAt = performance.now();
  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, config.requestCount) },
      runWorker,
    ),
  );
  const elapsedMs = performance.now() - runStartedAt;

  const failures = results.filter((result) => !result.ok);
  const statuses = {};
  const byScenario = {};
  for (const result of results) {
    const key = String(result.status || result.error);
    statuses[key] = (statuses[key] || 0) + 1;
    const scenario = byScenario[result.scenario] || { requests: 0, failed: 0, statuses: {}, durations: [] };
    scenario.requests += 1;
    scenario.durations.push(result.durationMs);
    if (!result.ok) scenario.failed += 1;
    scenario.statuses[key] = (scenario.statuses[key] || 0) + 1;
    byScenario[result.scenario] = scenario;
  }
  const scenarioSummary = Object.fromEntries(Object.entries(byScenario).map(([name, value]) => [name, {
    requests: value.requests,
    failed: value.failed,
    errorRate: Number((value.failed / value.requests).toFixed(4)),
    statuses: value.statuses,
    latencyMs: {
      p50: Number(percentile(value.durations, 0.5).toFixed(2)),
      p95: Number(percentile(value.durations, 0.95).toFixed(2)),
      p99: Number(percentile(value.durations, 0.99).toFixed(2)),
    },
  }]));
  const summary = {
    event: "load_test_complete",
    baseUrl: config.baseUrl,
    scenario: "booknest-representative-read-and-quote",
    requests: config.requestCount,
    concurrency: config.concurrency,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    throughputRequestsPerSecond: Number((config.requestCount / (elapsedMs / 1000)).toFixed(2)),
    failed: failures.length,
    errorRate: Number((failures.length / config.requestCount).toFixed(4)),
    statuses,
    byScenario: scenarioSummary,
    latencyMs: {
      p50: Number(percentile(results.map((result) => result.durationMs), 0.5).toFixed(2)),
      p95: Number(percentile(results.map((result) => result.durationMs), 0.95).toFixed(2)),
      p99: Number(percentile(results.map((result) => result.durationMs), 0.99).toFixed(2)),
    },
    failures: failures.map(({ path, status, error }) => ({ path, status, error })),
  };
  summary.slo = {
    targets: config.slo,
    passed: summary.latencyMs.p95 <= config.slo.p95LatencyMs &&
      summary.errorRate <= config.slo.errorRate &&
      summary.throughputRequestsPerSecond >= config.slo.throughputRequestsPerSecond,
    breaches: [
      ...(summary.latencyMs.p95 > config.slo.p95LatencyMs ? ["p95_latency"] : []),
      ...(summary.errorRate > config.slo.errorRate ? ["error_rate"] : []),
      ...(summary.throughputRequestsPerSecond < config.slo.throughputRequestsPerSecond ? ["throughput"] : []),
    ],
  };
  output(JSON.stringify(summary));
  return summary;
}

async function runSpikeTest(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const setting = (optionName, envName, fallback, maximum) => parseBoundedInteger(
    options[optionName] ?? env[envName],
    fallback,
    1,
    maximum,
    envName,
  );
  const phases = [
    { name: "baseline", requestCount: setting("baselineRequests", "LOAD_TEST_BASELINE_REQUESTS", 40, maximumRequestCount), concurrency: setting("baselineConcurrency", "LOAD_TEST_BASELINE_CONCURRENCY", 4, maximumConcurrency) },
    { name: "spike", requestCount: setting("spikeRequests", "LOAD_TEST_SPIKE_REQUESTS", 200, maximumRequestCount), concurrency: setting("spikeConcurrency", "LOAD_TEST_SPIKE_CONCURRENCY", 20, maximumConcurrency) },
    { name: "recovery", requestCount: setting("recoveryRequests", "LOAD_TEST_RECOVERY_REQUESTS", 40, maximumRequestCount), concurrency: setting("recoveryConcurrency", "LOAD_TEST_RECOVERY_CONCURRENCY", 4, maximumConcurrency) },
  ];
  const results = [];
  for (const phase of phases) {
    const summary = await runLoadTest({
      ...options,
      ...phase,
      log: () => {},
    });
    results.push({ phase: phase.name, ...summary });
  }
  const result = {
    event: "spike_test_complete",
    baseUrl: results[0].baseUrl,
    workload: "read-only browse, catalog, quote, health and categories",
    phases: results,
    recovered: results[2].failed === 0,
    sloPassed: results.every((phase) => phase.slo.passed),
  };
  (options.log || console.log)(JSON.stringify(result));
  return result;
}

async function main() {
  const summary = process.env.LOAD_TEST_PROFILE === "spike"
    ? await runSpikeTest({ env: process.env })
    : await runLoadTest();
  if (summary.failed > 0 || summary.slo?.passed === false || summary.phases?.some((phase) => phase.failed > 0 || phase.slo?.passed === false)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "load_test_failed",
      error: error.message,
    }));
    process.exitCode = 1;
  });
}

module.exports = { parseLoadTestConfig, percentile, runLoadTest, runSpikeTest };
