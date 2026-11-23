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

## Initial API SLO gate

The project API SLO is p95 under 1,000 ms, 5xx/error rate at or below 1%, and
throughput at or above 5 requests/second. The runner gates overall and each
scenario's p95/error rate; the spike profile gates every phase independently.
A breach is included in the JSON `slo` field and makes the CLI exit nonzero.
Override targets with `LOAD_TEST_SLO_P95_MS`, `LOAD_TEST_SLO_ERROR_RATE`
(fraction from 0 to 1), and `LOAD_TEST_SLO_THROUGHPUT_RPS`. CI runs the same
gate against an in-process server and 60 read-only requests to catch regressions.
Use staging measurements for capacity/release acceptance; CI and local throughput
are not a substitute for host and database capacity measurements.

### Recorded local baseline

Measured 2026-11-23 on the repository's local Windows execution environment:
in-process server, temporary file database, 60 requests, concurrency 6. The
workload returned 60/60 HTTP 200 responses; p50 5.62 ms, p95 29.11 ms, p99
45.75 ms, and observed throughput 611.25 requests/second. All six scenarios
passed individually (each p95 was at most 45.75 ms). This is a reproducible
functional baseline for regression checks, not a staging/production capacity
claim. Re-run with the same workload and record environment/release details when
collecting an operator baseline.

Runtime monitoring reports and alerts when the rolling five-minute API sample
has at least 20 requests and p95 exceeds 1,000 ms or 5xx rate exceeds 1%.
Alerts use the configured `MONITORING_ALERT_WEBHOOK_URL` and existing cooldown.
The production dashboard exposes the same rolling latency/error measurements.

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
numeric resource and recovery objectives with the service owner before the run.
Record the staging baseline against these project targets; a sustained breach
requires investigation and an explicit SLO change in review rather than silently
raising the thresholds. Local results cannot establish production capacity.

When a bottleneck is observed, reduce offered concurrency first, then inspect
the matching layer: bound the database pool and query duration, shed/reject
excess requests with 429/503 and retry guidance, and scale app instances or
database capacity only after verifying the constrained resource. Re-run the
same profile after changes and confirm database state remains unchanged.
