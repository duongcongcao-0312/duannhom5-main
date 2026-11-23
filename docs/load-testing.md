# Load test runbook

The built-in load test sends a bounded mix of browse (`/`), catalog data/list,
cart quote, checkout quote, health, and categories requests. Quotes are read-only:
the workload never creates orders, reserves stock, or submits payment. The local
cart itself lives in browser storage, so this script covers its server-side quote
request rather than browser rendering. Text matching is currently performed in
the browser, so the catalog-data scenario measures the API data fetch, not the
browser's local search algorithm.

## Safe execution

Run against a local instance by default. To use staging, set
`LOAD_TEST_BASE_URL=https://<staging-host>`,
`LOAD_TEST_ALLOW_STAGING=true`, and `LOAD_TEST_STAGING_HOSTS=<staging-host>`.
Production hosts are blocked. Use an isolated staging database and coordinate a
maintenance window before running. The runner caps each invocation at 500
requests, concurrency 20, and timeout 60 seconds.

Start with the default workload, then raise concurrency gradually while keeping
requests within the configured cap, for example:

```powershell
$env:LOAD_TEST_BASE_URL = 'https://staging.example.test'
$env:LOAD_TEST_ALLOW_STAGING = 'true'
$env:LOAD_TEST_STAGING_HOSTS = 'staging.example.test'
$env:LOAD_TEST_REQUESTS = '100'
$env:LOAD_TEST_CONCURRENCY = '5'
npm run load-test
```

The JSON summary reports overall and per-scenario request counts, status/error
rates, p50/p95/p99 latency, throughput, and failures. Save each run's output
alongside the staging release/version and test window.

## Measurements and acceptance record

The runner cannot observe host or database resources. During each run, capture
the staging platform's CPU and memory graphs, PostgreSQL pool utilization/waiting
clients, database CPU/connections, and application monitoring snapshot
(`/api/admin/monitoring`, using an authorized admin session). Compare metrics
before, during, and after each load step. Record the chosen target (requests and
concurrency), observed p95/error rate, resource peaks, and the first bottleneck.

Before and after the run, compare the isolated database's order count and
inventory quantities. Both must be unchanged because this workload only reads
catalog data and calculates quotes. Stop increasing load if errors rise, p95
latency breaches the staging SLO, resources approach their configured limits,
or the database pool reports waiting clients. Agree on numeric p95, error-rate,
and resource thresholds with the service owner before treating a run as passing;
there are no universal safe thresholds embedded in this generic runner.
