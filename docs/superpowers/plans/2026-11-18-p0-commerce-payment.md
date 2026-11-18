# P0 Commerce and Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure authoritative pricing, coupon/inventory invariants, safe payment configuration, and idempotent verified payment processing for issues #110, #112, and #113.

**Architecture:** Keep pricing, stock reservation, and payment transitions on the backend, backed by PostgreSQL transactions/constraints and the existing file adapter for local development. Use synthetic or provider sandbox data in tests; no production charge is part of automated validation.

**Tech Stack:** Node.js 20, PostgreSQL, existing migration runner, `node:test`, SePay configuration/API contract.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- Client-provided prices, discounts, user IDs, payment states, and order totals are untrusted.
- No order is marked paid without authenticated provider evidence matching order, amount, currency, and receiving account.
- Retries may not duplicate an order or payment; failed validation must not mutate inventory/payment state.
- Missing/invalid production payment configuration must fail closed without printing secret values.
- Never initiate real production transactions during tests.
- Do not commit unless the user explicitly asks.

## Review Focus

- Forged prices/discounts must not alter server-calculated totals; test changed client totals.
- Concurrent orders cannot reserve the same final stock; test two requests for one item.
- Deleted/discontinued products and invalid/over-quota coupons must be rejected; test both.
- A forged, duplicate, stale, conflicting, wrong-amount, or unmatched webhook must not mark an order paid; test each result.
- Missing or malformed SePay config must disable transfer clearly and fail production preflight; test missing and malformed settings.

---

### Task 1: Enforce authoritative pricing, coupon, inventory, and order state (#112)

**Files:**
- Modify as needed: `server.js`, `backend/coupons.js`, `backend/postgres-db.js`, `data/migrations/004_transactional_book_inventory.sql`, later migration only if required
- Test: `tests/backend-workflow.test.js`
- Test: `tests/backend-validation.test.js`
- Test: `tests/postgres-db.test.js`
- Test: `tests/backend-payment.test.js`

**Interfaces:**
- Consumes: order quote/create APIs, catalog, coupon validation, `createAndPersistOrder`, PostgreSQL order transaction, and current order state machine.
- Produces: backend-authoritative totals and atomic stock/coupon/order transitions with unchanged valid checkout responses.

- [ ] **Step 1: Add failing tests** for tampered price/total/discount, inactive/deleted product, invalid/expired/exhausted coupon, insufficient stock, forbidden client `paymentStatus`, and two concurrent requests for the last item.
- [ ] **Step 2: Run** `node --test tests/backend-workflow.test.js tests/backend-validation.test.js tests/postgres-db.test.js`; confirm each new case fails for the intended missing rule.
- [ ] **Step 3: Implement only missing validation/transaction behavior** in existing order and persistence flows; preserve server-computed currency rounding and idempotency behavior.
- [ ] **Step 4: Run** `npm.cmd run test:backend:workflow`, `npm.cmd run test:backend:validation`, and `node --test tests/postgres-db.test.js`; expect tampering to be ignored/rejected and concurrency to preserve stock.

### Task 2: Harden payment webhook identity, reconciliation, and idempotency (#113)

**Files:**
- Modify as needed: `server.js`, `backend/postgres-db.js`, `data/migrations/003_shared_order_idempotency.sql`, later migration only if required
- Test: `tests/backend-payment.test.js`
- Test: `tests/postgres-db.test.js`
- Test: `tests/postgres-migrations.test.js`

**Interfaces:**
- Consumes: `applyPaymentWebhookEvent(event)` in storage adapters and provider webhook contracts.
- Produces: unique transaction/event storage, one atomic payment transition per verified event, and queryable reconciliation history.

- [ ] **Step 1: Add failing tests** for invalid signature/API key, transaction ID duplicate, same ID with conflicting payload, replay/stale timestamp, wrong account/order/amount/currency, partial/unknown transfer, and concurrent duplicate delivery.
- [ ] **Step 2: Run** `npm.cmd run test:backend:payment` and `node --test tests/postgres-db.test.js tests/postgres-migrations.test.js`; confirm the new assertions fail before implementation.
- [ ] **Step 3: Add only provider-contract fields verified from the official SePay contract**; enforce unique transaction identifiers and atomic status/reconciliation writes. Keep secrets in environment configuration and compare signatures in constant time where applicable.
- [ ] **Step 4: Run** `npm.cmd run test:backend:payment` and `node --test tests/postgres-db.test.js tests/postgres-migrations.test.js`; expect duplicates to be no-op, conflicts to be rejected, and invalid evidence never to mark paid.

### Task 3: Validate production SePay configuration and checkout reporting (#110)

**Files:**
- Modify as needed: `server.js`, `scripts/predeploy-check.js`, `render.yaml`, `.env.example`, `main.js`, `index.html`
- Test: `tests/predeploy-check.test.js`
- Test: `tests/backend-runtime.test.js`
- Test: `tests/backend-payment.test.js`
- Test: `tests/site.test.js`

**Interfaces:**
- Consumes: `GET /api/payments/config`, `SEPAY_API_KEY`, `SEPAY_BANK_CODE`, `SEPAY_BANK_NAME`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, and the existing checkout.
- Produces: validated public bank display configuration (never the API key), explicit unavailable UI, and production preflight checks.

- [ ] **Step 1: Add failing tests** that missing/invalid required production payment settings fail preflight, API output excludes the API key, and the frontend refuses transfer checkout when config is unavailable while COD remains usable.
- [ ] **Step 2: Run** `node --test tests/predeploy-check.test.js tests/backend-payment.test.js tests/site.test.js`; confirm the expected failures.
- [ ] **Step 3: Validate all five environment variables** without emitting values; expose only required public bank fields through the payment config route and verify Render blueprint declares the secret keys as unsynchronized settings.
- [ ] **Step 4: Keep tests on synthetic fixtures**; do not place live account values in `.env.example`, tests, HTML, or reports.
- [ ] **Step 5: Run** `node --test tests/predeploy-check.test.js tests/backend-runtime.test.js tests/backend-payment.test.js tests/site.test.js`; expect config and frontend behavior to pass.

**External completion evidence:** SePay sandbox credentials, Render production settings, a valid receiver account, and a controlled end-to-end report require authorized operator access. Do not ask for credential values or run a real charge.
