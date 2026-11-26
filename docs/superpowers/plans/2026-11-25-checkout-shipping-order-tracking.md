# Versioned Checkout, Shipping, and Order Tracking Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete backend-priced checkout, delivery-fee transparency, and authorized order tracking for issues #253, #254, and #264 without changing v1 behavior or historical order totals.

**Architecture:** Add v2 order quote/create contracts with a required delivery zone; keep v1 unchanged. Calculate shipping on the server using the existing policy, persist a per-order fee/zone/ETA snapshot to file and PostgreSQL stores, and expose only appropriate fields in authorized order responses.

**Tech Stack:** Node.js 20, vanilla JavaScript, PostgreSQL ordered migrations, Node.js `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-issues-247-264-design.md`

## Global Constraints

- API v1 quote and create-order behavior must remain unchanged for at least 180 days.
- v2 requires an explicit valid zone; never infer or silently default the zone from free-form address text.
- Use the existing fee policy: inner-city 20,000 VND, nationwide 30,000 VND, remote 45,000 VND; shipping is free at a 300,000 VND subtotal only for non-remote zones.
- Server quotes and order creation remain authoritative for inventory, discounts, shipping, and totals.
- Preserve idempotency, ownership, access-code, payment, and transaction guarantees.
- Preserve historical order totals; do not derive missing historical shipping fees.
- Do not expose recipient address through guest lookup.
- Do not add a dependency or perform migrations against production.

## Review Focus

- Missing/invalid zone in v2 must fail validation, while v1 requests without the new field retain old behavior; assert both in `tests/api-versioning.test.js` and `tests/backend-validation.test.js`.
- The package runtime (`server.js`) and modular app (`backend/app.js`) must both preserve the requested API version through canonicalization and order dispatch; cover each through the existing `createServer` contract tests.
- Free-shipping threshold is based on the documented subtotal and does not apply to `remote`; pin below/at/above threshold and each zone in `tests/backend-validation.test.js`.
- A retry with changed zone/fee must not replay a different order under the same idempotency key; cover the request fingerprint in `tests/order-idempotency.test.js`.
- Migrated orders retain their total and have no inferred fee; validate the migration and old/new round trips in `tests/postgres-migrations.test.js`.
- Guest tracking must include the shipping snapshot but never recipient address; assert the public projection and ownership in `tests/order-idor.test.js`.

---

## File Structure

- Modify: `backend/api-versioning.js`, `backend/app.js`, `backend/router.js`, `backend/routes/orders.js`, `backend/validation.js`, and `server.js` for v2 routing and request validation. `server.js` is the package runtime entrypoint; keep its dispatch behavior aligned with `backend/app.js`.
- Reuse: `backend/shipping-policy.js` and its `estimateShipping({ zone, subtotal })` function.
- Modify: `backend/db.js`, `backend/postgres-db.js`, and `backend/order-idempotency.js` for snapshot validation, persistence, reads, and fingerprints.
- Create: `data/migrations/028_checkout_shipping.sql` for nullable legacy zone, zero-default legacy fee, and the revised order-total constraint.
- Modify: `docs/api-versioning-policy.md` and `docs/openapi.json` for version/contract documentation.
- Modify: `index.html`, `main.js`, `main.css`, and `tests/e2e/commerce-flow.spec.js` for zone selection and order summary/tracking.
- Modify: `tests/api-versioning.test.js`, `tests/backend-validation.test.js`, `tests/backend-payment.test.js`, `tests/order-idempotency.test.js`, `tests/postgres-db.test.js`, `tests/postgres-migrations.test.js`, and `tests/e2e/commerce-flow.spec.js`.

### Task 1: Add v2 order routing while preserving v1 (#253, #264)

**Files:**
- Modify: `backend/api-versioning.js`
- Modify: `backend/app.js`
- Modify: `server.js`
- Modify: `backend/router.js`
- Modify: `docs/api-versioning-policy.md`
- Modify: `tests/api-versioning.test.js`

**Interfaces:**
- Consumes: `resolveApiVersion(pathname)`, which preserves `version`, `canonicalPath`, and `versionedPath`.
- Produces: v2 routing for order quote/create; v1 and legacy `/api/*` retain v1 behavior and response contract.

- [ ] **Step 1: Add failing tests** for `/api/v2/orders/quote` and `POST /api/v2/orders`, v2 response header, unchanged `/api/v1` and `/api` behavior, continued rejection of unsupported versions, and matching behavior from both server compositions.
- [ ] **Step 2: Run `node --test tests/api-versioning.test.js`** and verify v2 fails as unsupported while v1 tests pass.
- [ ] **Step 3: Add v2 to supported versions and preserve version identity through route dispatch** so order handlers can choose v1 or v2 validation after canonicalization; emit the requested API version header for explicit versioned requests and keep alias `/api/*` mapped to v1.
- [ ] **Step 4: Document that only quote/create-order semantics use v2** and that v1 remains supported for the existing minimum window.
- [ ] **Step 5: Run `node --test tests/api-versioning.test.js tests/request-limits.test.js`** and confirm v1/v2/alias routing and limits remain correct.

### Task 2: Calculate and persist shipping snapshots (#253, #264)

**Files:**
- Modify: `backend/app.js`
- Modify: `server.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/validation.js`
- Modify: `backend/db.js`
- Modify: `backend/postgres-db.js`
- Modify: `backend/order-idempotency.js`
- Create: `data/migrations/028_checkout_shipping.sql`
- Modify: `tests/backend-validation.test.js`
- Modify: `tests/backend-payment.test.js`
- Modify: `tests/order-idempotency.test.js`
- Modify: `tests/postgres-db.test.js`
- Modify: `tests/postgres-migrations.test.js`

**Interfaces:**
- Consumes: existing `estimateShipping({ zone, subtotal })`, order creation, order fingerprint, file-store update validation, PostgreSQL `store_orders`, and the existing `legacy_record` round trip.
- Produces: v2 order `shippingZone`, `shippingFee`, `estimatedBusinessDays`, and `total = subtotal - discount + shippingFee`; v1 and old orders remain unchanged.

- [ ] **Step 1: Add failing v2 quote/order tests** for missing/invalid zones, 20,000/30,000/45,000 VND fees, the 300,000 VND threshold (including remote exclusion), quote/create total parity, and idempotent retry.
- [ ] **Step 2: Add failing storage/migration tests** proving new shipping snapshots survive file/PostgreSQL round trips and existing orders retain their original total without invented shipping fields.
- [ ] **Step 3: Run the focused backend tests** and confirm each new assertion fails for the missing v2 contract/snapshot, not for unavailable PostgreSQL infrastructure.
- [ ] **Step 4: Implement version-aware quote/create calculation** using the existing shipping estimator and require `shippingZone` only for v2; keep v1's existing formula and validation unchanged.
- [ ] **Step 5: Include zone, fee, and ETA in the idempotency fingerprint** so a reused key with a changed shipping selection cannot be treated as the same order.
- [ ] **Step 6: Create migration 028** with `shipping_zone` nullable for old rows, `shipping_fee` defaulting to zero, and a total constraint that permits legacy rows only with no zone/zero fee and enforces an allowed zone, nonnegative fee, and `subtotal - discount + shipping_fee` for zoned rows; update relational mapping/upsert and file-store update validation consistently.
- [ ] **Step 7: Run `node --test tests/backend-validation.test.js tests/backend-payment.test.js tests/order-idempotency.test.js tests/postgres-db.test.js tests/postgres-migrations.test.js`**; report database-dependent skips/failures separately from passing local-store coverage.

### Task 3: Connect checkout UI to the v2 quote/create contract (#253, #264)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Modify: `main.css`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/commerce-flow.spec.js`

**Interfaces:**
- Consumes: v2 quote/create request with required `shippingZone`; response includes server `subtotal`, `discount`, `shippingFee`, `freeShippingApplied`, `estimatedBusinessDays`, `total`, and line totals.
- Produces: required zone selector for the existing three policy zones and a server-matched price breakdown before confirmation.

- [ ] **Step 1: Add failing UI/E2E assertions** for zone selection, quote fee display, server-computed total, zone change recalculation, required input, and preserved zone/form data after a failed submit.
- [ ] **Step 2: Run the focused checkout tests** and verify they fail because the current form lacks zone input and shipping rows.
- [ ] **Step 3: Add the accessible zone selector and quote breakdown**; send the selected zone to v2 quote and create-order endpoints and render only the returned values.
- [ ] **Step 4: Preserve the idempotency key and selected zone for explicit in-page retries only; do not persist the zone in browser storage. Disable repeated submit while pending and restore button/loading state on all outcomes.**
- [ ] **Step 5: Run `node --test tests/site.test.js tests/backend-validation.test.js` and the focused commerce E2E flow**; verify displayed quote equals the created order total for each zone class.

### Task 4: Complete order tracking details and empty/error/loading states (#254)

**Files:**
- Modify: `backend/app.js`
- Modify: `server.js`
- Modify: `main.js`
- Modify: `index.html`
- Modify: `tests/order-idor.test.js`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/commerce-flow.spec.js`

**Interfaces:**
- Consumes: existing authorized order lookup, `publicOrder(order)`, guest access-code verification, and optional shipping snapshot fields.
- Produces: accessible date/status/items/payment/shipping summary for returned fields, with distinct loading/empty/error states and no guest-visible recipient address.

- [ ] **Step 1: Add failing tests** for old v1 and v2 tracking details (date, status, items, payment, optional shipping), authenticated empty “my orders”, failed/unauthorized lookup, loading/retry, and guest output excluding recipient address.
- [ ] **Step 2: Run the focused order-tracking tests** and verify the current UI/projection omits the required date/payment/shipping details or does not distinguish empty/loading/error results.
- [ ] **Step 3: Extend the public projection only with optional shipping snapshot fields** and render creation time, status, payment state, items, and zone/fee when present; keep private address out of guest responses.
- [ ] **Step 4: Add explicit loading and empty/error feedback** for both single-order lookup and “my orders”, without discarding entered order ID/access code; disable duplicate lookups while a request is pending and provide an actionable empty-state path.
- [ ] **Step 5: Run `node --test tests/order-idor.test.js tests/site.test.js` and the commerce Playwright flow** in desktop/mobile projects, including keyboard-only checkout and tracking.

## Completion

- Issues #253, #254, and #264 are covered here.
- Run migration/integration tests only against a disposable test database, then run the full project suite and the documented browser matrix before claiming completion.
