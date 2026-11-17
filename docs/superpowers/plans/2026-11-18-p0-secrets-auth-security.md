# P0 Secrets, Authentication, and Browser Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close repository-verifiable secret, identity/ownership, session, and browser-security gaps in issues #109, #111, and #114.

**Architecture:** Keep bearer-token authentication and existing Node.js middleware/security modules. Add only missing safeguards, route-level authorization/ownership tests, and CI secret scanning; treat actual credential rotation as an operator-controlled external action.

**Tech Stack:** Node.js 20, plain JavaScript, `node:test`, GitHub Actions, Gitleaks.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- Never print or store matched secret values; scan with redaction and report only redacted paths/fingerprints.
- Do not ask for or commit provider credentials.
- Trust verified session identity and role only; never trust client-supplied `userId` or `role`.
- Keep bearer tokens tab-scoped; add CSRF defenses only if cookie authentication is introduced.
- Preserve existing API behavior except where an authorization defect requires rejection.
- Do not commit unless the user explicitly asks.

## Review Focus

- A leaked value in Git history must be redacted from terminal logs, CI output, and artifacts; test scanner output handling with a synthetic fixture.
- Requests with forged `userId`/`role` must retain the authenticated session identity; test cross-user order access and role escalation.
- Expired/revoked sessions must fail on protected routes; test expiry, logout, and refresh paths.
- HTML-like book/customer text must render inertly; test existing safe-render paths and headers.
- Untrusted origins must not receive credentialed CORS access; test allowed and rejected origins and preflight.

---

### Task 1: Add secret scanning and safe configuration checks (#109)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Create: `.gitleaks.toml` only if verified false positives require a narrow allowlist
- Test: `tests/security-hardening.test.js`
- Test: `tests/predeploy-check.test.js`

**Interfaces:**
- Consumes: repository Git history and current CI workflow.
- Produces: a CI scan for pushes and pull requests plus configuration checks that never echo values.

- [ ] **Step 1: Add failing assertions** that the CI workflow runs a secret scanner on push/PR and `.env.example` contains only blank/sample values for sensitive settings.
- [ ] **Step 2: Run** `node --test tests/security-hardening.test.js tests/predeploy-check.test.js`; confirm the new assertions fail for the missing scanner/config rule.
- [ ] **Step 3: Add Gitleaks CI scanning** with repository-safe permissions; use redacted output and avoid uploading unredacted scanner reports. Add only narrowly scoped allowlist entries for deterministic synthetic test fixtures.
- [ ] **Step 4: Add safe `.env.example` assertions** and remove any real credential if found without including its value in output or artifacts.
- [ ] **Step 5: Run a local all-ref scan** using `gitleaks detect --source . --log-opts=--all --redact --report-format json --report-path <temporary-path>`; summarize counts and affected refs/paths only, then remove the temporary report.
- [ ] **Step 6: Run** `npm.cmd run check` and `node --test tests/security-hardening.test.js tests/predeploy-check.test.js`; expect all tests to pass and scanner output to be redacted.
- [ ] **Step 7: Record credential rotation/revocation as pending operator evidence** until the account owner confirms each provider has invalidated the old credential. Never infer revocation from repository cleanup.

### Task 2: Verify and close authentication, RBAC, and ownership gaps (#111)

**Files:**
- Modify as needed: `backend/authorization.js`, `backend/auth.js`, `backend/router.js`, `server.js`
- Test: `tests/authorization.test.js`
- Test: `tests/backend-auth.test.js`
- Test: `tests/backend-admin.test.js`
- Test: `tests/backend-customer.test.js`
- Test: `tests/backend-workflow.test.js`

**Interfaces:**
- Consumes: `authenticate(request, sessionStore, RequestError)`, `requireRole(...)`, `requireCustomerPermission(...)`, and `getAdminPermission(pathname, method)`.
- Produces: server-derived actor identity/role and explicit owner checks on sensitive user/order operations.

- [ ] **Step 1: Add failing ownership and role-escalation cases**: User A supplies User B's `userId` or `role`, attempts to list/read/update B's order, and a customer calls representative admin routes.
- [ ] **Step 2: Run** `node --test tests/authorization.test.js tests/backend-auth.test.js tests/backend-admin.test.js tests/backend-workflow.test.js`; confirm failures are the expected authorization gaps.
- [ ] **Step 3: Map every user/order/admin route** to public, authenticated-owner, staff permission, or admin permission; encode missing checks using existing authorization helpers and the authenticated session actor.
- [ ] **Step 4: Add audit records** for authorized sensitive administrative changes using the existing audit module and actor identity; do not log credentials or unnecessary PII.
- [ ] **Step 5: Run** `npm.cmd run test:backend:auth`, `npm.cmd run test:backend:admin`, `npm.cmd run test:backend:customer`, and `npm.cmd run test:backend:workflow`; expect access denials and owner access to match the policy matrix.

### Task 3: Verify session expiry/revocation, safe rendering, CSP, and CORS (#114)

**Files:**
- Modify as needed: `backend/auth.js`, `backend/security.js`, `backend/router.js`, `server.js`, `assets/api-client.js`, `main.js`
- Test: `tests/security-hardening.test.js`
- Test: `tests/backend-auth.test.js`
- Test: `tests/site.test.js`
- Test: `tests/backend-workflow.test.js`

**Interfaces:**
- Consumes: current bearer-token session storage, server security headers, CORS allowlist, and safe DOM-rendering helpers.
- Produces: tested session lifecycle, no unsafe HTML insertion in reviewed user-controlled paths, CSP/CORS rules, and a documented cookie/CSRF decision.

- [ ] **Step 1: Add failing tests** for logout/expiry/revocation across protected APIs, CORS denial for an untrusted origin, CSP presence on API/static/error responses, and hostile user text remaining inert.
- [ ] **Step 2: Run** `node --test tests/security-hardening.test.js tests/backend-auth.test.js tests/site.test.js tests/backend-workflow.test.js`; confirm any new failures correspond to uncovered behavior.
- [ ] **Step 3: Fix only verified gaps** using the existing bearer-token design, response security headers, allowlist, and safe rendering conventions. Do not introduce cookies without a separate approved architecture decision.
- [ ] **Step 4: Run** `npm.cmd run test:backend:auth`, `npm.cmd run test:site`, and `node --test tests/security-hardening.test.js tests/backend-workflow.test.js`; expect session, header, CORS, and rendering assertions to pass.

**External completion evidence:** Credential rotation/revocation and GitHub push-protection settings are not complete until an authorized owner verifies them in provider settings. Do not close #109/#114 based only on repository changes.
