# Shared UI Foundation and Admin Experience Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the shared UI foundation and complete admin states, responsiveness, contrast, and keyboard behavior required by issues #247, #248, #256, #257, #258, #259, #260, #261, #262, and #263.

**Architecture:** Keep the existing static HTML/CSS/JavaScript architecture and separate storefront/admin stylesheets. Reuse shared semantic tokens and the existing toast system; keep backend permission checks authoritative.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-issues-247-264-design.md`

## Global Constraints

- Do not replace the current HTML/CSS/JavaScript architecture or perform a broad visual redesign.
- Do not add commerce features, alter payment methods, or change account/role policy beyond what the issue checklists require.
- WCAG 2.2 AA and the browser matrix already documented in this repository define accessibility/browser acceptance.
- Do not change backend authorization; the UI may expose only controls supported by a role, and the backend remains authoritative.
- Reuse the shared toast implementation for success, warning, and error feedback.
- Preserve the existing visual distinction between storefront and admin while sharing semantic design tokens.

## Review Focus

- Normal-size text token combinations must reach 4.5:1, large text 3:1, and UI boundaries/focus indicators 3:1; pin each audited pair in `tests/accessibility.test.js`.
- Keyboard focus must remain visible on admin buttons, links, selects, and custom controls; exercise the tab flow in the admin Playwright test.
- Admin empty datasets must not be confused with failed requests; cover successful empty and failed-load results separately, including permission/server errors.
- Narrow admin tables/navigation must remain reachable without page-level horizontal overflow; assert portrait and landscape behavior in the mobile browser project.
- Status announcements must not report failures as success or create duplicate feedback; cover success/error semantics in `tests/toast.test.js` and admin-flow tests.

---

## File Structure

- Modify `main.css` and `admin.css` for semantic tokens, typography, focus, and responsive admin styles.
- Create `docs/design-system.md` to document the token/component inventory, compatibility conventions, and breakpoints.
- Modify `admin.html` and `admin.js` for skip navigation, view status semantics, and truthful admin operation states.
- Reuse `assets/toast.js` and `assets/toast.css`; change only if a verified acceptance gap remains.
- Add `tests/accessibility.test.js` for measurable contrast pairs and update `tests/site.test.js` for required document semantics.
- Create `tests/e2e/admin-ux.spec.js` for real keyboard/responsive/admin state behavior.
- Add `docs/accessibility-contrast-audit.md` with measured combinations, ratios, browser/device coverage, and any verified limitations.

### Task 1: Standardize semantic tokens and verify contrast (#247, #248, #263)

**Files:**
- Modify: `main.css`
- Modify: `admin.css`
- Create: `docs/design-system.md`
- Create: `tests/accessibility.test.js`
- Create: `docs/accessibility-contrast-audit.md`

**Interfaces:**
- Consumes: the existing `:root` storefront and admin token sets.
- Produces: named semantic color/type/spacing tokens and a recorded contrast audit; no new runtime dependency.

- [ ] **Step 1: Write failing contrast tests** for the actual semantic text/surface, button, status, disabled, and focus-token pairs. Assert WCAG 2.2 AA thresholds: 4.5:1 normal text, 3:1 large text, and 3:1 non-text controls/focus.
- [ ] **Step 2: Run the tests and verify** each failure identifies a measured failing pair, not a parser or test-fixture error.
- [ ] **Step 3: Align both stylesheets to semantic tokens** for palette, font scale, line height, heading levels, spacing, controls, and shared states; adjust only measured failing colors.
- [ ] **Step 4: Document the token/component inventory, compatibility conventions, breakpoints, and measured contrast pairs/ratios** in `docs/design-system.md` and `docs/accessibility-contrast-audit.md`.
- [ ] **Step 5: Run `node --test tests/accessibility.test.js`** and confirm the token/contrast checks pass; also run `node --test tests/site.test.js` and compare its failures with the recorded baseline.

### Task 2: Complete admin loading, empty, error, and action feedback (#256, #258–#261)

**Files:**
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `admin.css`
- Create: `tests/e2e/admin-ux.spec.js`

**Interfaces:**
- Consumes: current `apiFetch`, role checks, admin loaders, and `window.booknestToast`.
- Produces: separate loading/empty/error/success states for admin tasks without changing API authorization or the admin data contract.

- [ ] **Step 1: Add failing browser checks** for delayed loading, a successful empty admin list, offline/timeout/server/permission failures, a successful state update, duplicate-submit prevention, and destructive-action confirmation; assert each produces only its corresponding status/message.
- [ ] **Step 2: Run the focused browser test** and verify it fails on the current ambiguous/missing state.
- [ ] **Step 3: Update admin list loaders and mutations** so every async action enters an announced loading state, prevents duplicate submission where applicable, restores controls in `finally`, and distinguishes empty results from offline/timeout/server/permission errors.
- [ ] **Step 4: Keep role-specific UI controls consistent with existing permissions** and preserve backend authorization as the security boundary.
- [ ] **Step 5: Run `node --test tests/site.test.js tests/toast.test.js` and the focused admin Playwright spec**; verify no failed request produces success feedback.

### Task 3: Make admin keyboard and responsive navigation usable (#256, #257, #262)

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `admin.js`
- Modify: `tests/site.test.js`
- Modify: `tests/e2e/admin-ux.spec.js`

**Interfaces:**
- Consumes: existing admin navigation tabs, view sections, and dialog controls.
- Produces: a skip link, visible focus, keyboard-operable navigation, and responsive table/navigation behavior in the documented browser matrix.

- [ ] **Step 1: Add failing checks** for the skip target, keyboard view selection, visible focus, and mobile reachability of admin navigation and tables.
- [ ] **Step 2: Run the focused checks** and confirm failures correspond to missing semantics or responsive behavior.
- [ ] **Step 3: Implement only required markup/CSS/JS changes**; preserve native button semantics and keep horizontally scrollable tables usable without page-level overflow.
- [ ] **Step 4: Run `node --test tests/site.test.js tests/accessibility.test.js` and the admin Playwright keyboard/mobile checks** in the project browser matrix, including portrait and landscape viewports.
- [ ] **Step 5: Append the measured viewport and browser outcomes** to `docs/accessibility-contrast-audit.md` or the project QA record; do not claim physical-device coverage from emulation.

## Completion

- Issues #247, #248, #256, the admin portions of #257–#262, and #263 are covered by the tasks above; storefront portions of #257–#262 and #258–#261 are covered by the storefront and checkout plans.
- Run the full Node test suite after the related plans are complete. Preserve and report any pre-existing baseline failure by name.
