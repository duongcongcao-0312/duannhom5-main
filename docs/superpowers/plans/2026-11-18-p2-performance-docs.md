# P2 Performance, Load Testing, and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and address evidence-backed performance issues, produce safe repeatable load tests, and align technical/operations docs for issues #125–#127.

**Architecture:** Establish a baseline before optimizing. Reuse PostgreSQL pagination/indexes and existing build/image practices; run synthetic load only on authorized staging or isolated local services. Update docs after implementation so they describe verified behavior rather than intended behavior.

**Tech Stack:** Node.js 20, PostgreSQL, existing pagination APIs, Playwright/E2E setup from #121 if available, k6 or another approved load tool.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- Do not load-test production or use real customer/payment data.
- Measure before changing queries, cache policy, or image assets.
- Cache only public data; never share cached personalized responses.
- Do not add a CDN/object-storage provider without owner approval.
- Documentation may claim only features verified in code or provider evidence.
- Do not commit unless the user explicitly asks.

## Review Focus

- Pagination must bound results and keep stable ordering; test boundary and invalid limits.
- Cache must not mix personalized responses; test request identity and cache headers.
- Image conversion must preserve asset references and acceptable display; test generated pages and static paths.
- Load testing must not accidentally target production; enforce an explicit safe base URL and reject production hostnames.
- Documentation must not include real secrets or obsolete production endpoints; add bounded repository assertions.

---

### Task 1: Measure and optimize database, pagination, cache, and images (#125)

**Files:**
- Modify only where baseline supports it: `backend/postgres-db.js`, `server.js` or extracted route modules, `main.css`, image assets, `scripts/build-pages.js`
- Test: `tests/api-pagination.test.js`
- Test: `tests/site.test.js`
- Add benchmark script/report fixture only if needed

**Interfaces:**
- Consumes: existing paginated API query parameters and static asset pipeline.
- Produces: before/after measurements and targeted improvements without leaking or mixing user data.

- [ ] **Step 1: Establish a reproducible baseline** for catalog/list queries, page size, response size, static image size, and representative page load; record commands and synthetic dataset size.
- [ ] **Step 2: Add a failing regression test** for each identified issue (unbounded response, unstable pagination, N+1 query, unsafe cache header, or oversized asset); avoid speculative optimization.
- [ ] **Step 3: Implement the smallest evidence-backed change**; add indexes through a migration only when query plan/data show a benefit.
- [ ] **Step 4: Run** `npm.cmd run test:site`, `node --test tests/api-pagination.test.js tests/postgres-db.test.js`, and the same benchmark; compare results and check no personalized response is cached.
- [ ] **Step 5: Record before/after measurements** and any remaining bottleneck in the final report.

### Task 2: Add safe synthetic load testing and report (#126)

**Files:**
- Create: `tests/load/` scenario and instructions
- Modify: `package.json` only if a reproducible runner command is added
- Update: `.github/workflows/ci.yml` only for non-production validation that is bounded and deterministic

**Interfaces:**
- Consumes: explicit `LOAD_TEST_BASE_URL`, synthetic fixtures, order/inventory APIs, and approved staging/local target.
- Produces: p50/p95/p99 latency, error rate, resource/database observations, and inventory consistency evidence.

- [ ] **Step 1: Add a failing safety test** that refuses missing or production `LOAD_TEST_BASE_URL` and validates a bounded duration/concurrency.
- [ ] **Step 2: Run** the load-test configuration test and confirm it fails for unsafe/missing target configuration.
- [ ] **Step 3: Implement a repeatable synthetic scenario** for catalog/search/auth/cart/checkout and concurrent inventory reservation; keep concurrency, duration, and request rates bounded by explicit arguments.
- [ ] **Step 4: Run locally** with a small deterministic profile, then run staging only after operator authorization; capture p50/p95/p99, errors, resource use, and inventory invariants.
- [ ] **Step 5: Produce a report** with environment, test data, thresholds, results, limitations, and recommendations; do not include credentials or real user data.

### Task 3: Align developer, API, database, payment, privacy, and operations docs (#127)

**Files:**
- Modify: `README.md`, `ARCHITECTURE.md`, `docs/openapi.json`, `docs/deployment.md`, `docs/ci-gates.md`, `docs/backup-restore-incident-runbook.md`, `docs/production-readiness-checklist.md`, `privacy.html`
- Test: `tests/site.test.js`
- Validate: OpenAPI and documentation commands established in #119

**Interfaces:**
- Consumes: verified application behavior and provider-operator checklists from prior plans.
- Produces: setup, architecture, API/database/migration, Firebase, SePay, deployment, rollback, backup/restore, troubleshooting, and privacy documentation.

- [ ] **Step 1: Add failing documentation assertions** for required setup commands, current endpoint/config names, and absence of known stale production URLs/credential-like values.
- [ ] **Step 2: Run** `npm.cmd run test:site` and OpenAPI validation; confirm the assertions identify stale or missing documentation.
- [ ] **Step 3: Update docs from verified code and tests**; explicitly label provider operations that require an authorized operator and avoid claiming unperformed production acceptance.
- [ ] **Step 4: Run** `npm.cmd run check`, `npm.cmd run test:site`, OpenAPI validation, and `npm.cmd run build:pages`; expect docs assertions and build to pass.
- [ ] **Step 5: Review every newly added URL/configuration value** for stale hosts and secret exposure.

**External completion evidence:** Staging load results, monitoring-resource measurements, and provider-specific CDN/storage decisions require authorized environment access. Repository documentation alone is not evidence that these ran.
