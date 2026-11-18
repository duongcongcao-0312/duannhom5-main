# P0 Rate Limits and Guest Order Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace process-local abuse controls with shared production rate limits and require a separate high-entropy access code for guest order lookups.

**Architecture:** Use PostgreSQL atomic buckets for production limits and retain file-backed limits only for local/demo mode. Generate a guest access code in the browser, send it only over HTTPS, store only its verifier, and require the order UUID plus code for guest detail/status lookup.

**Tech Stack:** Node.js 20, `node:test`, PostgreSQL migrations, static HTML/JavaScript.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-113-138-design.md`; GitHub issues #131 and #133.

## Global Constraints

- Do not modify production data, run production migrations, send real payment webhooks, load-test production, or expose credentials/PII.
- Do not modify issue #130 code; the user authorized continuing other issues only.
- Preserve PostgreSQL for configured production deployments and JSON/file storage for local/demo.
- Guest order tracking uses a separate high-entropy access code, distinct from the UUID; store only a verifier/hash and require both values for guest lookups.
- Keep error messages generic where needed to prevent account/order enumeration; never log passwords, tokens, access codes, IP addresses, or raw email addresses.
- Do not modify the paused Playwright E2E spec or enable E2E execution without user authorization.
- Before implementation, verify prerequisite work for #109–#112, #114, #119, and #124 is present; do not duplicate or regress completed work.

## Review Focus

- A forged `X-Forwarded-For` header must not change the rate-limit identity unless the socket peer is configured as a trusted proxy.
- If PostgreSQL rate-limit storage is unavailable, protected endpoints must fail closed with a sanitized service error rather than silently bypassing limits.
- Concurrent requests across two server instances must share one atomic counter and produce a stable 429/`Retry-After` result at the configured limit.
- A guest UUID without a valid access code must not reveal order data; existing guest orders without a verifier must be denied public lookup.
- An idempotent guest-order retry must use the same code and key; changing the access code with the same idempotency key must be rejected.

---

### Task 1: Shared production rate limiting (#131)

**Files:**
- Create: `data/migrations/015_shared_rate_limits.sql`
- Modify: `backend/security.js`
- Modify: `backend/db.js`
- Modify: `backend/postgres-db.js`
- Modify: `backend/routes/auth.js`, `backend/routes/orders.js`
- Modify: `server.js`, `scripts/predeploy-check.js`, `.env.example`, `render.yaml`
- Modify: `docs/deployment.md`, `docs/production-readiness-checklist.md`
- Test: `tests/backend-auth.test.js`, `tests/backend-payment.test.js`, `tests/migrations.test.js`, `tests/postgres-db.test.js`, `tests/postgres-integration.test.js`, `tests/postgres-migrations.test.js`, `tests/predeploy-check.test.js`
- Create: `tests/rate-limit.test.js`

**Interfaces:**
- Consumes: `PostgresDatabase`, the existing file-backed `checkRateLimit`, and current route-specific limits (login and reauthentication 5/15 minutes, registration 5/15 minutes, password reset 30/IP and 5/email per 15 minutes).
- Produces: `consumeRateLimit(bucketKey, limit, windowMs, now)` on the persistence adapter, returning `{ allowed, count, remaining, resetAt }`; production bucket updates must be atomic in PostgreSQL.
- Produces: `clearRateLimit(bucketKey)` on both adapters so a successful login/reauthentication preserves the existing behavior of clearing its failure bucket.
- Produces: `getClientAddress(request, trustedProxyHops, trustedProxyIps)` that ignores forwarded headers by default and only derives a client address when the socket peer is allowlisted and the operator explicitly configures the trusted proxy hop count.

- [x] **Step 1: Add failing tests** for the listed Review Focus cases, login/registration/password-reset and order endpoint limits, generic auth failures, sanitized suspicious-request logs, and `Retry-After` on 429.
- [x] **Step 2: Run the focused rate-limit/auth/PostgreSQL tests** and confirm the new shared-store and trusted-proxy assertions fail before implementation.
- [x] **Step 3: Add migration 015 and an atomic PostgreSQL bucket operation.** Namespace bucket IDs by endpoint and keyed-hash identity values with `RATE_LIMIT_HMAC_KEY`; never persist raw IP/email identifiers. Expire stale rows without requiring an in-memory cleanup worker.
- [x] **Step 4: Route production limits through PostgreSQL and local/demo limits through the file adapter.** Fail closed with 503 if a required production limiter cannot reach its store; keep public unauthenticated responses generic.
- [x] **Step 5: Apply limits to login, reauthentication, registration, password reset/email delivery, guest order lookup, and order creation.** Preserve existing limits; use 30 requests per 15 minutes per source for order lookup/creation. Add `Retry-After` seconds for 429 responses.
- [x] **Step 6: Use `request.socket.remoteAddress` unless `RATE_LIMIT_TRUSTED_PROXY_HOPS` and `RATE_LIMIT_TRUSTED_PROXY_IPS` are explicitly configured.** In proxy mode, parse the forwarded chain only from an allowlisted socket peer and document that the edge must strip client-supplied forwarding headers.
- [x] **Step 7: Add the production-only secret/config validation and document `RATE_LIMIT_HMAC_KEY`, proxy configuration, local fallback, and store-outage behavior.** Declare the key non-synced in `render.yaml`; do not provision or deploy it.
- [x] **Step 8: Run `node --test tests/rate-limit.test.js tests/backend-auth.test.js tests/backend-payment.test.js tests/postgres-db.test.js tests/postgres-migrations.test.js tests/postgres-integration.test.js tests/predeploy-check.test.js`.** If a dedicated PostgreSQL test URL is unavailable, report the database integration portion as not run rather than passing.

### Task 2: Guest order access-code protection (#133)

**Files:**
- Create: `data/migrations/016_guest_order_access_codes.sql`
- Modify: `server.js`, `backend/routes/orders.js`, `backend/db.js`, `backend/postgres-db.js`, `backend/order-idempotency.js`
- Modify: `main.js`, `index.html`, `docs/openapi.json`
- Test: `tests/backend-customer.test.js`, `tests/backend-validation.test.js`, `tests/backend-payment.test.js`, `tests/postgres-db.test.js`, `tests/postgres-migrations.test.js`, `tests/site.test.js`

**Interfaces:**
- Consumes: Task 1 rate limiting and the existing `Idempotency-Key` order-creation flow.
- Produces: guest orders with `accessCodeHash` only; public guest reads require UUID plus `X-Order-Access-Code`; authenticated owners/admins retain their existing authorized access.
- Produces: checkout-generated 256-bit hex access codes held in page memory for retries and shown to the guest with the order confirmation; no raw code is returned from the API or stored in either persistence adapter.

- [x] **Step 1: Add failing tests** for UUID-only guest detail/status lookup denial, wrong-code denial, correct-code access, user-A/user-B isolation, invalid UUIDs, and response/log/cache data not exposing the verifier.
- [x] **Step 2: Add failing idempotency tests** proving the same key and code replay the same order while a different code under the same key returns 409.
- [x] **Step 3: Add migration 016 and persist the access-code verifier** in file and PostgreSQL order records; ensure `publicOrder` and administrative serializers omit it.
- [x] **Step 4: Update order creation to accept an access code only for guest orders.** Validate the 256-bit hex shape, hash it before persistence, and include only the verifier in the idempotency comparison; keep the raw code in request memory only.
- [x] **Step 5: Require `X-Order-Access-Code` for unauthenticated guest detail and payment-status reads.** Return the same generic 404 for a missing order and a guest order with a missing/invalid code; compare fixed-length verifier digests with `timingSafeEqual`. Keep UUID-only access denied for legacy guest orders that have no verifier; do not add a fallback based on UUID, phone, or email.
- [x] **Step 6: Update checkout to generate one 32-byte cryptographic code per idempotency key, retain it in page memory and resend it on retries, show it only in the successful guest confirmation, and add an access-code field to the order tracker.** Use the header for lookups, never a URL query parameter or persistent browser storage.
- [x] **Step 7: Update OpenAPI and checkout/tracker copy** to describe the one-time displayed guest code, lookup header, legacy-order limitation, and authenticated-owner behavior.
- [x] **Step 8: Run the focused order/site/migration suites and then `npm.cmd test`.** Report the PostgreSQL-only skip if no dedicated test database is configured.

### Task 3: Local verification and operator gates

- [x] Run `npm.cmd run check`, `npm.cmd run predeploy:check`, OpenAPI validation, and `npm.cmd run build:pages`.
- [ ] Keep staging provisioning, multi-instance production confirmation, trusted proxy configuration, and actual production migrations pending until an operator supplies evidence.
- [ ] Do not run E2E or edit `tests/e2e/commerce-flow.spec.js` while the user's pause remains in effect.
