# Issues 101-108 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the eight open reliability, privacy, payment, deployment, and release-gate issues without weakening existing security controls or changing unrelated behavior.

**Architecture:** Keep the existing Node.js HTTP server, file/PostgreSQL persistence, static frontend, and Node test runner. Reuse existing payment idempotency, webhook, migration, authentication, and pre-deploy helpers; add only the missing frontend integration, consent API/enforcement, browser-storage cleanup, production checks, and CI assertions.

**Tech Stack:** Node.js 20, plain JavaScript, PostgreSQL migrations, static HTML/CSS, Node `node:test`, GitHub Actions.

**Spec:** GitHub issues #101-#108 in `duongcongcao-0312/duannhom5-main`.

## Global Constraints

- Do not commit or expose credentials, personal data, webhook secrets, or database URLs.
- Preserve existing API contracts unless a new endpoint is required by an issue.
- Authentication tokens remain tab-scoped; cart/favorites may remain client-side, but unnecessary personal data must not be persisted.
- Payment state changes must be authenticated, idempotent, amount/order matched, and safe under retries.
- Production deployment must fail fast on invalid required configuration and must expose liveness/readiness checks.
- Release checks must fail closed when blocking tests or required validation fail.
- Existing unrelated worktree changes, including `scripts/create-github-issues.js`, must not be reverted.

## Review Focus

- Missing or malformed `/api/payments/config` must leave the checkout in an explicit unavailable state, not silently use a real account.
- A webhook with a valid signature but wrong order, amount, currency, account, or event replay must not mark an order paid.
- Consent withdrawal must prevent later use of the withdrawn purpose while preserving an auditable record.
- Logout and expired sessions must remove browser session artifacts without deleting persistent cart/favorites unexpectedly.
- Production configuration failures must identify the missing setting without printing its value.

---

### Task 1: Complete payment configuration integration (#101)

**Files:**
- Modify: `main.js`
- Modify: `index.html`
- Test: `tests/backend-payment.test.js`
- Test: `tests/site.test.js`

**Interfaces:**
- Consumes: `GET /api/payments/config` and the existing checkout quote/order endpoints.
- Produces: a frontend payment-config loader that renders only backend-provided bank details and reports configuration errors explicitly.

- [ ] **Step 1: Add failing coverage** for a checkout that loads `/api/payments/config`, uses its `bankCode`, `accountNumber`, and `accountName` in the VietQR URL/details, and does not use a hardcoded account when the request fails.
- [ ] **Step 2: Run the focused payment/site tests** and confirm the new assertions fail against the hardcoded frontend.
- [ ] **Step 3: Implement the payment-config loader** with an explicit loading/error state and validation of required response fields; remove the real bank/account values from `index.html` and `main.js`.
- [ ] **Step 4: Keep checkout order creation using the existing idempotency key** and ensure a config failure blocks transfer checkout with a visible error while preserving COD.
- [ ] **Step 5: Run `npm.cmd test -- tests/backend-payment.test.js tests/site.test.js`** and confirm the focused suite passes.

### Task 2: Remove public personal data (#102)

**Files:**
- Modify: `index.html`
- Modify: `tests/site.test.js`
- Test: `tests/security-hardening.test.js`

**Interfaces:**
- Consumes: the public social-login demo UI.
- Produces: clearly synthetic demo profiles or a provider-selection UI with no personal names/emails from repository contributors.

- [ ] **Step 1: Add a repository assertion** that public HTML contains no known personal email/name data and that demo profiles use reserved/example identities.
- [ ] **Step 2: Run the focused test and confirm it fails** on the current quick-login profiles.
- [ ] **Step 3: Replace the quick-login profiles with synthetic `example.com` identities and neutral display names**, preserving the existing demo flow.
- [ ] **Step 4: Run `npm.cmd test -- tests/site.test.js tests/security-hardening.test.js`** and confirm the privacy checks pass.

### Task 3: Implement consent recording and enforcement (#103)

**Files:**
- Modify: `backend/router.js`
- Modify: `server.js`
- Modify: `backend/db.js`
- Modify: `backend/postgres-db.js`
- Modify: `data/customer-schema.sql`
- Create: `data/migrations/008_consent_enforcement.sql`
- Modify: `docs/openapi.json`
- Test: `tests/backend-customer.test.js`
- Test: `tests/postgres-migrations.test.js`

**Interfaces:**
- Consumes: the existing customer identity and database abstraction.
- Produces: authenticated consent endpoints for recording, listing, and withdrawing purpose-specific consent, with policy version and source metadata.

- [ ] **Step 1: Add failing API tests** for recording consent, listing current consent, withdrawing consent, rejecting invalid purpose/version/source, and preventing use of a withdrawn purpose.
- [ ] **Step 2: Add the ordered migration/schema constraints** for consent records and run the migration-focused test to verify the schema before implementation.
- [ ] **Step 3: Implement file and PostgreSQL persistence methods** with append-only audit records and a current-state query per customer/purpose.
- [ ] **Step 4: Add authenticated routes and authorization checks**; return sanitized validation errors and never expose unrelated customer records.
- [ ] **Step 5: Integrate consent checks into customer-data collection/service/order paths** where the repository already accepts a purpose, without blocking strictly necessary order fulfillment when the order purpose is valid.
- [ ] **Step 6: Update OpenAPI and privacy documentation** with exact request/response shapes and withdrawal semantics.
- [ ] **Step 7: Run `npm.cmd test -- tests/backend-customer.test.js tests/postgres-migrations.test.js tests/site.test.js`** and confirm the consent behavior passes.

### Task 4: Minimize personal browser storage (#104)

**Files:**
- Modify: `main.js`
- Modify: `assets/api-client.js`
- Modify: `book-detail.js`
- Modify: `tests/site.test.js`
- Test: `tests/storage-resilience.test.js`

**Interfaces:**
- Consumes: current `booknestAuth`, cart, favorites, customer-info, and service-request storage keys.
- Produces: a storage policy where auth/session and customer profile data are session-scoped or memory-scoped, logout clears all session artifacts, and cart/favorites behavior remains compatible.

- [ ] **Step 1: Add failing storage assertions** for no personal profile in persistent localStorage, complete logout cleanup, and preservation of non-personal cart/favorites.
- [ ] **Step 2: Move customer profile/service draft data out of persistent localStorage**; keep only the minimum non-personal checkout convenience data needed by the current UX.
- [ ] **Step 3: Centralize logout cleanup** through `booknestAuth.clearToken()` plus explicit removal of session-scoped customer/profile keys.
- [ ] **Step 4: Update architecture documentation** so the documented storage model matches the implementation.
- [ ] **Step 5: Run `npm.cmd test -- tests/site.test.js tests/storage-resilience.test.js`** and confirm the storage tests pass.

### Task 5: Harden cold-start retries and idempotency (#105)

**Files:**
- Modify: `assets/api-client.js`
- Modify: `main.js`
- Modify: `server.js`
- Modify: `backend/order-idempotency.js`
- Test: `tests/backend-runtime.test.js`
- Test: `tests/backend-payment.test.js`

**Interfaces:**
- Consumes: the existing 15-second request timeout and `Idempotency-Key` order flow.
- Produces: bounded retry behavior for safe requests and a single-attempt/idempotent policy for order creation.

- [ ] **Step 1: Add failing tests** for bounded retry on GET/health/config requests, no automatic replay of order creation without the same idempotency key, and clear timeout errors.
- [ ] **Step 2: Implement retry with exponential backoff and jitter only for safe methods/statuses**, with a small fixed maximum and abort support.
- [ ] **Step 3: Keep non-idempotent order requests from being replayed automatically** while reusing the existing key when the user explicitly retries.
- [ ] **Step 4: Run `npm.cmd test -- tests/backend-runtime.test.js tests/backend-payment.test.js`** and confirm the retry/idempotency tests pass.

### Task 6: Complete production configuration and deployment checks (#106)

**Files:**
- Modify: `scripts/predeploy-check.js`
- Modify: `server.js`
- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Modify: `docs/production-readiness-checklist.md`
- Modify: `tests/predeploy-check.test.js`
- Modify: `tests/smoke-monitoring.test.js`

**Interfaces:**
- Consumes: `DATABASE_URL`, `NODE_ENV`, `ADMIN_*`, `CORS_ORIGINS`, migration directory, and existing `/health`/`/ready`.
- Produces: fail-fast production validation and documented health/readiness deployment evidence.

- [ ] **Step 1: Add failing pre-deploy tests** for missing/invalid `DATABASE_URL`, invalid production credentials, and readiness failure when the database is unavailable.
- [ ] **Step 2: Implement non-secret `DATABASE_URL` validation** and ensure production uses the shared PostgreSQL session store before accepting traffic.
- [ ] **Step 3: Verify `/health` remains dependency-light and `/ready` checks required dependencies**, returning stable JSON/status codes.
- [ ] **Step 4: Update `.env.example`, deployment instructions, and the checklist** with Render Free cold-start, health/readiness, rollback, and post-deploy verification steps.
- [ ] **Step 5: Run `npm.cmd test -- tests/predeploy-check.test.js tests/smoke-monitoring.test.js`** and confirm the checks pass.

### Task 7: Close payment webhook gaps (#107)

**Files:**
- Modify: `server.js`
- Modify: `backend/postgres-db.js`
- Modify: `backend/db.js`
- Modify: `docs/openapi.json`
- Modify: `tests/backend-payment.test.js`

**Interfaces:**
- Consumes: existing HMAC/SePay webhook routes, payment config, order lookup, and `applyPaymentWebhookEvent`.
- Produces: verified, replay-safe payment state transitions with strict reconciliation.

- [ ] **Step 1: Add failing tests** for wrong currency/account, malformed transaction IDs, invalid signatures/API keys, mismatched order code/amount, duplicate events, and stale events.
- [ ] **Step 2: Implement strict provider payload normalization and reconciliation** before persistence; reject invalid inputs with sanitized errors.
- [ ] **Step 3: Preserve database-level duplicate protection and transaction ordering** for both file and PostgreSQL implementations.
- [ ] **Step 4: Document webhook configuration and event contract** without including secrets.
- [ ] **Step 5: Run `npm.cmd test -- tests/backend-payment.test.js tests/postgres-migrations.test.js`** and confirm all webhook cases pass.

### Task 8: Establish release-blocking CI coverage (#108)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `tests/site.test.js`
- Create: `tests/release-gates.test.js`
- Modify: `docs/production-readiness-checklist.md`

**Interfaces:**
- Consumes: existing Node test scripts, site tests, backend tests, pre-deploy checks, and build-pages command.
- Produces: a CI gate that blocks release on auth, cart/order, payment, authorization, responsive/site, build, and security failures.

- [ ] **Step 1: Add focused release-gate tests** that exercise login validation, cart persistence, order idempotency, payment verification, RBAC denial, and required responsive/site markers.
- [ ] **Step 2: Run the new release-gate test and confirm it fails** for each missing contract before implementation.
- [ ] **Step 3: Wire the release-gate test and existing targeted suites into CI** with explicit blocking steps and retained reports.
- [ ] **Step 4: Update the production checklist** with the exact commands and pass/fail evidence required before release.
- [ ] **Step 5: Run `npm.cmd run check`, `npm.cmd run test:site`, `npm.cmd run test:backend`, `npm.cmd run predeploy:check`, and `npm.cmd run build:pages`**; record any baseline failures separately from regressions caused by these changes.

## Baseline Note

The initial `npm.cmd test` run currently fails 58 of 149 tests before implementation, including existing authentication, validation, payment, and production-startup tests. The implementation must not claim a green full suite until those baseline failures are isolated and either fixed as directly required by these issues or documented as unrelated pre-existing failures.
