# P1 Architecture, API, and Test Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `server.js` responsibility while keeping REST/OpenAPI compatibility and improving core business test coverage for issues #118–#121.

**Architecture:** Extract one domain at a time behind current server tests, retaining dependency injection and route behavior. Validate OpenAPI as a contract, raise coverage for a named set of business modules, and run Playwright against isolated local/test services.

**Tech Stack:** Node.js 20, PostgreSQL, `node:test`, c8, OpenAPI 3.1, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- Preserve existing `/api` behavior and public status/response shapes unless a reviewed contract defect requires a change.
- Keep server-derived authorization and transaction boundaries intact during extraction.
- Add dependencies only when required by an approved task and pin them in the lockfile.
- E2E data and credentials must be synthetic; no production traffic or secrets.
- Do not commit unless the user explicitly asks.

## Review Focus

- Extracted handlers must receive the same auth/database/config dependencies; test injected database failure and auth denial.
- Unknown/malformed params and queries must yield a bounded validation error; test invalid pagination/filter values.
- OpenAPI must validate structurally and remain aligned with implementation; test changed route/schema drift.
- Coverage must apply to the explicitly selected business modules, not be diluted by generated or test code; test the configured include set.
- E2E retries must not duplicate orders or leak traces containing credentials; test idempotent retry and artifact redaction.

---

### Task 1: Extract server route/domain modules incrementally (#118)

**Files:**
- Create: focused modules under `backend/` (route handler modules grouped by domain)
- Modify: `server.js`, `backend/router.js`
- Test: existing backend test files; add `tests/server-composition.test.js` only if dependency wiring lacks coverage
- Update: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `createServer(options)` public API, existing storage/auth/config dependencies, `findRoute`, and current request validation/response helpers.
- Produces: server bootstrap that wires domain modules without changing endpoint behavior.

- [ ] **Step 1: Add characterization tests** for route dispatch, auth, error responses, health/readiness, and injected database dependencies before moving a handler.
- [ ] **Step 2: Run** `npm.cmd test`; record unchanged baseline failures separately.
- [ ] **Step 3: Extract one cohesive domain module at a time**, beginning with a bounded route group; pass dependencies as explicit arguments instead of importing globals.
- [ ] **Step 4: After each extraction, run its owning test file and `npm.cmd run check`; do not combine behavior changes with extraction.
- [ ] **Step 5: Continue until** `server.js` only loads config, constructs dependencies, composes routes/middleware, and manages the HTTP server lifecycle; verify no circular dependency using Node module graph tooling or a focused test.
- [ ] **Step 6: Update the architecture diagram** and run `npm.cmd test`; expected behavior and responses remain compatible.

### Task 2: Complete REST/OpenAPI contract and CI validation (#119)

**Files:**
- Modify: `server.js` or extracted API modules, `backend/router.js`, `docs/openapi.json`, `.github/workflows/ci.yml`, `package.json`
- Test: `tests/site.test.js`, `tests/router.test.js`, `tests/backend-validation.test.js`

**Interfaces:**
- Consumes: the route registry and existing request validators/pagination helpers.
- Produces: accurate OpenAPI schemas/status/security definitions and machine validation in CI.

- [ ] **Step 1: Add failing contract tests** for representative public/auth/admin routes, error response shape, pagination bounds, and OpenAPI-to-route coverage.
- [ ] **Step 2: Run** `node --test tests/router.test.js tests/backend-validation.test.js tests/site.test.js`; confirm the selected contract gap.
- [ ] **Step 3: Update OpenAPI** to match current route methods, auth, query/body schemas, success/error statuses, and local-only server URL; do not invent a breaking `/v2`.
- [ ] **Step 4: Add a reproducible OpenAPI schema validation command** to `package.json` and invoke it in `.github/workflows/ci.yml`.
- [ ] **Step 5: Run** `node --test tests/router.test.js tests/backend-validation.test.js tests/site.test.js` and the OpenAPI validator; expect route contract and schema checks to pass.

### Task 3: Raise critical business logic coverage to 80% (#120)

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`, `docs/ci-gates.md`
- Test: existing `tests/business-constants.test.js`, `tests/backend-validation.test.js`, `tests/backend-payment.test.js`, `tests/postgres-db.test.js`, and focused module tests

**Interfaces:**
- Consumes: c8 and current test commands.
- Produces: an explicit coverage gate of at least 80% for named critical business modules, with existing global thresholds retained.

- [ ] **Step 1: Define the module include set** from pricing, coupons, inventory/order state, authorization, idempotency, payment, and consent code; exclude generated `dist/` and test files.
- [ ] **Step 2: Add tests for uncovered behavior** in each selected module and run focused tests to confirm new assertions fail first.
- [ ] **Step 3: Configure a separate c8 critical-business coverage command** with 80% threshold for the chosen modules; do not silently lower existing repository-wide thresholds.
- [ ] **Step 4: Run** the critical coverage command and `npm.cmd run test:coverage`; expected result is the agreed 80% critical-module gate and current global thresholds passing.
- [ ] **Step 5: Document exact scope/thresholds** in `docs/ci-gates.md`.

### Task 4: Add Playwright end-to-end flows (#121)

**Files:**
- Create: Playwright config and `tests/e2e/` flows
- Modify: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`
- Reuse: `server.js`, test database, build scripts

**Interfaces:**
- Consumes: local frontend/backend URLs and isolated synthetic database credentials.
- Produces: repeatable E2E for auth, search, cart, checkout/coupon/payment failure, order tracking, admin, and ownership checks.

- [ ] **Step 1: Add a failing smoke E2E test** that starts the app, opens the storefront, and verifies a known catalog item; first identify a deterministic local test setup.
- [ ] **Step 2: Add Playwright as a development dependency** only after the test design is established, and configure browser install/cache in CI.
- [ ] **Step 3: Add tests** for register/login, search/detail, cart/checkout/coupon, payment-failure behavior, order tracking/ownership, and admin book/order permission using synthetic accounts.
- [ ] **Step 4: Capture screenshots/traces only on failure** and ensure artifact uploads do not include secret env files or customer data.
- [ ] **Step 5: Run** the E2E suite locally against isolated storage/database and in CI; expected result is all critical flows pass without production services.

**External completion evidence:** Running E2E against staging requires a configured staging environment and safe test accounts. CI/local completion does not prove staging acceptance.
