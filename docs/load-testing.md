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

Start with the default workload, then run the bounded three-phase spike profile.
It performs a 40-request/4-worker baseline, an abrupt 200-request/20-worker
spike, then a 40-request/4-worker recovery sample. Each phase is a finite burst;
the runner does not hold a request rate for a wall-clock duration. Each phase
reports p50/p95/p99 latency, throughput and failures. Override phase sizes with
`LOAD_TEST_BASELINE_REQUESTS`, `LOAD_TEST_BASELINE_CONCURRENCY`,
`LOAD_TEST_SPIKE_REQUESTS`, `LOAD_TEST_SPIKE_CONCURRENCY`,
`LOAD_TEST_RECOVERY_REQUESTS`, and `LOAD_TEST_RECOVERY_CONCURRENCY`.

Example staging invocation:

```powershell
$env:LOAD_TEST_BASE_URL = 'https://staging.example.test'
$env:LOAD_TEST_ALLOW_STAGING = 'true'
$env:LOAD_TEST_STAGING_HOSTS = 'staging.example.test'
$env:LOAD_TEST_PROFILE = 'spike'
npm run load-test
```

For the smaller single-phase smoke benchmark, leave `LOAD_TEST_PROFILE` unset
and use `LOAD_TEST_REQUESTS` / `LOAD_TEST_CONCURRENCY`.

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

Capture metrics immediately before baseline, throughout all three phases, and
until the service is stable after recovery: platform CPU/memory/restarts,
PostgreSQL CPU/connections, pool total/idle/waiting, request timeout and 5xx
counts. Compare the isolated database's order count and inventory quantities
before and after; both must be unchanged because this workload is read-only.
Record environment/release, date, phase settings, each phase's summary, resource
peaks, queue/pool waits, timeout/dependency errors, and time to return to
baseline. A recovery phase with zero failures is necessary but does not by
itself prove resource recovery. Stop if error rate rises, p95 breaches the
staging SLO, resources approach configured limits, or pool waiters appear. Set
numeric p95, error-rate, resource and recovery objectives with the service owner
before the run; the repository has no measured staging capacity or agreed SLO,
so local results cannot establish a production capacity limit.

When a bottleneck is observed, reduce offered concurrency first, then inspect
the matching layer: bound the database pool and query duration, shed/reject
excess requests with 429/503 and retry guidance, and scale app instances or
database capacity only after verifying the constrained resource. Re-run the
same profile after changes and confirm database state remains unchanged.
