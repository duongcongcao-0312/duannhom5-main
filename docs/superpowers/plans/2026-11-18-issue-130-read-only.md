# Issue #130 Read-Only Investigation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify and report source-code causes that can produce HTTP 500 when an administrator updates an order status, without changing code or contacting production.

**Architecture:** Trace the admin dropdown handler through the HTTP request, authorization/validation, order update handler, and JSON/PostgreSQL persistence paths. Compare the active PostgreSQL order model and migration history, then separate verified code paths from hypotheses that require Render logs or authorized staging access.

**Tech Stack:** Node.js, browser JavaScript, PostgreSQL migrations, existing `node:test` suites; read-only inspection only.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-113-138-design.md`, GitHub issue #130.

## Global Constraints

- Issue #130 is read-only: do not modify files, call production update endpoints, connect to Supabase production, run migrations, commit, push, or deploy.
- Do not display secrets, credentials, customer PII, or production records.
- Preserve the current worktree, including the unrelated `assets/api-config.js` and `tests/site.test.js` modifications.
- Stop after delivering the diagnostic report and wait for the user's confirmation before making any change related to #130 or continuing the issue batch.

## Review Focus

- Exact method, endpoint, payload, and response path used by the admin status dropdown; verify by tracing handler and API call.
- Authorization, role/permission, and applicable CSRF protections; inspect middleware and route order without sending requests.
- Persistence differences between JSON and PostgreSQL, including migration 005 and the active `store_orders`, `store_order_items`, and `booknest_data` paths.
- Status/payment-state validation and transaction boundaries; establish whether status updates invoke SePay/payment logic.
- Production-only failure hypotheses; label each as unverified unless existing local evidence proves it, and specify the safe Render log evidence needed.

---

### Task 1: Trace the admin order-status request and persistence paths

**Files:**
- Read: `admin.js`
- Read: `server.js`
- Read: `backend/router.js`
- Read: `backend/authorization.js`
- Read: `backend/db.js`
- Read: `backend/postgres-db.js`
- Read: `data/migrations/`
- Read: `tests/backend-admin.test.js`
- Read: `tests/backend-workflow.test.js`
- Read: `tests/postgres-db.test.js`

**Interfaces:**
- Consumes: the issue's reported symptom and existing source/tests only.
- Produces: a concise report naming exact files/line numbers, request method/path/payload, route/authorization path, persistence/transaction behavior, confirmed causes, and hypotheses requiring redacted Render logs.

- [ ] **Step 1: Trace the admin dropdown event handler** and record the exact HTTP method, endpoint, headers, payload, and client-side error handling.
- [ ] **Step 2: Trace the matching backend route** through authentication, permission checks, request validation, order-state rules, response mapping, and error handling.
- [ ] **Step 3: Compare JSON and PostgreSQL update implementations** and inspect the migration that introduced the relational order tables for schema/query/transaction mismatch risks.
- [ ] **Step 4: Check payment coupling and relevant tests** to determine whether status updates call payment/SePay logic or change payment state, and identify missing regression cases.
- [ ] **Step 5: Deliver the read-only report** with confirmed findings separated from Render-log hypotheses, a minimal proposed fix, and tests to add. Do not edit files or proceed to any other issue until the user responds.

**Verification:** Confirm the report's file references and line numbers directly from the current checkout. No application tests, API calls, migrations, or production access are required or permitted for this read-only investigation.
