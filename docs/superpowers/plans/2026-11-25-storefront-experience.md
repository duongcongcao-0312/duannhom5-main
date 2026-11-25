# Storefront Catalog, Cart, and Profile Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified catalog, product-detail, cart, profile, keyboard/mobile, and storefront feedback gaps in issues #249–#252, #255, #257, #258, #259, #260, #261, and #262.

**Architecture:** Preserve the existing client-rendered storefront and static/demo catalog. Keep API data and server quote authoritative when configured, and expose explicit degraded, loading, empty, and error states using existing UI helpers.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-issues-247-264-design.md`

## Global Constraints

- Do not replace the current HTML/CSS/JavaScript architecture or perform a broad visual redesign.
- Preserve static/demo catalog behavior when the backend is intentionally not configured.
- When a configured API fails, show a truthful degraded/error notice and retry path; never report failure as a successful empty result.
- Preserve the server as the authority for prices, inventory, discounts, authentication, and ownership.
- Retain user-entered form data on failure where safe; never show an unsuccessful backend request as success.
- WCAG 2.2 AA and the documented Chrome, Edge, and iPhone 13 / mobile Safari matrix define accessibility/browser acceptance.

## Review Focus

- API unavailable versus intentional static mode must be distinguishable; exercise both in `tests/e2e/storefront-ux.spec.js`.
- A successful empty catalog/filter/favorites result must expose a recovery action; verify reset/return-to-shopping behavior in the same spec.
- Malformed or unavailable browser storage must not silently erase a non-empty cart; cover storage failure and quote failure separately.
- Account profile reads/updates must use the authenticated self-service API and never expose another user's data; test account ownership through the existing profile API test.
- Search, product detail, cart, and profile controls must remain reachable and readable on mobile and by keyboard; cover mobile Safari emulation and keyboard flows.

---

## File Structure

- Modify: `index.html`, `main.js`, `main.css` for catalog, cart, account-profile markup, and feedback states.
- Modify: `book-detail.js`, `book.html`, and `main.css` for product-detail loading/error/empty behavior.
- Create: `tests/e2e/storefront-ux.spec.js` for catalog/cart/profile, keyboard, and mobile behavior.
- Reuse: `assets/api-client.js`, `assets/toast.js`, and existing `/api/books` and `/api/auth/customer-info` contracts.
- Modify: `tests/site.test.js`

### Task 1: Make catalog hydration and navigation truthful and recoverable (#249, #250, #257, #258, #260, #262)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Modify: `main.css`
- Modify: `tests/site.test.js`
- Create: `tests/e2e/storefront-ux.spec.js`

**Interfaces:**
- Consumes: `hydrateCatalog()`, existing static `BOOKNEST_BOOKS`, `/api/books`, category rendering, and the existing API connection notice.
- Produces: explicit catalog loading/degraded/error state with retry, an accessible mobile navigation control, and preserved intentional static/demo mode and client-side filters.

- [x] **Step 1: Add failing tests** for loading before catalog resolution, a valid empty API response, offline/timeout/server/permission failures with static fallback and retry, intentionally unconfigured static mode, keyboard-operable mobile navigation, and core navigation/search/category/book-detail links.
- [x] **Step 2: Run the focused tests** and verify the configured-API error case fails because current code only logs and silently retains static items.
- [x] **Step 3: Implement a small catalog-state renderer** that distinguishes `loading`, `ready`, `empty`, and `error`; preserve usable static items on API failure but label them as fallback and expose retry. Replace the hidden-on-mobile-only navigation with an accessible toggle that supports keyboard and Escape.
- [x] **Step 4: Keep catalog counts, filters, sorting, pagination, and category controls synchronized** after success, retry, and empty results.
- [x] **Step 5: Run `node --test tests/site.test.js` and the focused storefront Playwright checks** for API success, empty, failure, retry, and mobile keyboard navigation. Playwright passed 27 tests with 3 profile-based skips; the full site test file has two previously identified unrelated baseline failures.

### Task 2: Complete catalog empty recovery and book-detail feedback (#250, #251, #259, #260, #262)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Modify: `book-detail.js`
- Modify: `book.html`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/storefront-ux.spec.js`

**Interfaces:**
- Consumes: catalog filter state, `hydrateBookDetails()`, existing `escapeHtml`, `booknestToast`, and the `/api/books` detail/review/related endpoints.
- Produces: actionable no-result states and separate product data errors/empty sections; out-of-stock products remain impossible to add.

- [x] **Step 1: Add failing tests** for a no-match catalog with reset action, no matching favorites with a clear-filter action, keyboard-operated gallery, valid detail metadata (title, image, price, ISBN, author, publisher, description, and stock), missing book, detail offline/server failure, no related books, and unavailable reviews.
- [x] **Step 2: Run the focused tests** and confirm empty and failed responses are distinguishable.
- [x] **Step 3: Add reset/recovery actions to the catalog empty state** and show explicit, scoped retry/error states for details, reviews, and related books without erasing already-rendered valid product data.
- [x] **Step 4: Preserve metadata/gallery behavior, safe text rendering, keyboard-operated gallery buttons, and the disabled add-to-cart behavior for zero stock.**
- [x] **Step 5: Run `node --test tests/site.test.js` and the product-detail/catalog Playwright checks** at desktop and mobile widths. Browser matrix: 63 passed, 3 profile-based skips. Full site tests: 62 passed with the same two unrelated baseline failures.

### Task 3: Harden cart loading, empty, quote-error, storage, and keyboard feedback (#252, #258–#262)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Modify: `main.css`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/storefront-ux.spec.js`

**Interfaces:**
- Consumes: `renderCart()`, `refreshCartQuote()`, local cart storage, and the server `/api/orders/quote` contract. Checkout totals with a delivery fee are completed by the checkout/API plan.
- Produces: distinct cart loading, empty, quote-error, and ready states; accessible quantity controls and a clear checkout CTA.

- [ ] **Step 1: Add failing tests** for empty cart, a delayed quote, offline/server quote rejection, invalid/unavailable storage, quantity update, out-of-stock state, recovery after a failed quote, focus entry/return, and Escape closing the custom cart panel.
- [ ] **Step 2: Run the focused tests** and verify they fail for the intended missing/ambiguous state.
- [ ] **Step 3: Implement explicit quote-state feedback and retry**; surface cart persistence failures without silently treating an existing cart as empty. Give the custom cart panel dialog semantics, move focus into it, restore focus on close, and support Escape without trapping users.
- [ ] **Step 4: Preserve quantity limits, server-sourced prices, coupon behavior, form state, and disable checkout until a valid current quote is available.**
- [ ] **Step 5: Run `node --test tests/site.test.js` and the focused cart Playwright tests** on desktop/mobile and by keyboard.

### Task 4: Add authenticated profile management (#255)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Modify: `main.css`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/storefront-ux.spec.js`
- Reuse: `tests/profile-update.test.js`

**Interfaces:**
- Consumes: `GET/PATCH /api/auth/customer-info`, `state.user.customerInfo`, and the existing password-change and reauthentication flows.
- Produces: an account-dialog profile view/editing only the existing self-service fields; student/verification status is read-only unless the current API already authorizes updates.

- [ ] **Step 1: Add failing tests** for profile view when signed in, no profile access while signed out, successful update, validation/API failure with retained input, read-only verification state, existing password-change access, and account action loading/error feedback.
- [ ] **Step 2: Run the focused account/profile tests** and verify they fail because the account dialog has no profile view.
- [ ] **Step 3: Add the profile view and submit through the existing authenticated customer-info API**; reuse current validation/reauthentication, show explicit loading/success/error feedback, and retain form contents on failure.
- [ ] **Step 4: Verify logout and expired-session behavior** clears the profile view and does not render stale account data.
- [ ] **Step 5: Run `node --test tests/profile-update.test.js tests/site.test.js` and the focused account Playwright tests** on desktop/mobile and by keyboard.

## Completion

- Issues #249–#252, #255, the storefront portions of #257–#262, and #258–#261 are covered here; shared design/admin work is in the foundation plan, and shipping/checkout/order tracking is in the checkout plan.
- Run the full Node test suite after the dependent checkout plan and report any environmental or baseline failures explicitly.
