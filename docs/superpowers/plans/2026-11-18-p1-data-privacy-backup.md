# P1 Data, Privacy, and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve relational integrity, consent enforcement, and recoverability for issues #115, #116, and #117.

**Architecture:** Extend existing PostgreSQL migrations/adapters and file-backed development behavior. Keep consent purpose-specific and append-only where auditability requires it. Reuse existing backup scheduler, manifest, verification, alert, and runbook facilities; defer provider-specific storage until selected by an authorized operator.

**Tech Stack:** PostgreSQL, Node.js 20, migration runner, `node:test`, existing backup scripts.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- Migrations must run in order on fresh and populated test databases.
- Related multi-table changes must be atomic; never hide database failures.
- Consent is scoped by authenticated user, purpose, and policy version; essential order processing is not blocked by optional marketing consent.
- Logs and backups must not expose secrets or unnecessary PII.
- Do not choose or provision an external storage vendor without operator approval.
- Do not commit unless the user explicitly asks.

## Review Focus

- A failed migration must roll back without marking the version applied; test failure and retry.
- A user cannot read/update another user's consent; test with two authenticated users.
- Withdrawal must not erase audit history and must stop later use of that purpose; test current state and history.
- Backup restore must reject changed/missing files and never overwrite unrelated target data silently; test corrupted manifest and nonempty destination.
- Missing external backup storage must be reported as an operational blocker, not as successful independent backup; test configuration/preflight behavior.

---

### Task 1: Verify relational schema constraints, transactions, and migration paths (#115)

**Files:**
- Modify only if needed: `data/migrations/*.sql`, `data/customer-schema.sql`, `backend/postgres-db.js`, `scripts/migrate.js`
- Test: `tests/postgres-db.test.js`
- Test: `tests/postgres-migrations.test.js`
- Test: `tests/postgres-integration.test.js`

**Interfaces:**
- Consumes: current migration runner, `PostgresDatabase`, relational tables, order/inventory/payment transaction methods.
- Produces: evidence-backed constraints/indexes and passing fresh/upgrade migration behavior.

- [ ] **Step 1: Add failing migration/integration tests** for the selected missing FK/unique/check constraints and transaction rollback invariants; do not add constraints without confirming existing data compatibility.
- [ ] **Step 2: Run** `node --test tests/postgres-db.test.js tests/postgres-migrations.test.js`; run `npm.cmd run test:postgres-integration` only against a dedicated test database.
- [ ] **Step 3: Add the smallest ordered migration** for proven schema gaps and update adapters so multi-table operations use one transaction.
- [ ] **Step 4: Test fresh and populated upgrade paths**, including rollback on injected constraint failure; expected result is no orphan data and no partially applied operation.
- [ ] **Step 5: Run** `npm.cmd run test:postgres-ssl`, `npm.cmd run test:postgres-integration`, and focused migration tests with a dedicated `DATABASE_URL`; record skips if the isolated database is unavailable.

### Task 2: Connect consent UI, enforce purpose state, and document data requests (#116)

**Files:**
- Modify: `main.js`, `index.html`, `privacy.html`, `backend/db.js`, `backend/postgres-db.js`, `server.js`, `docs/openapi.json`
- Modify only if required: `data/migrations/008_privacy_consents.sql` or a later migration
- Test: `tests/backend-customer.test.js`
- Test: `tests/site.test.js`

**Interfaces:**
- Consumes: authenticated `GET/POST /api/privacy/consents` and purpose-specific revoke endpoint, plus the current file/PostgreSQL consent persistence.
- Produces: account UI for reading/changing consent, server-side checks for optional purposes, and an accurate retention/data-request policy.

- [ ] **Step 1: Add failing API/UI tests** for consent retrieval, grant/update/revoke, unauthenticated access, cross-account isolation, and disabled optional purpose after withdrawal.
- [ ] **Step 2: Run** `npm.cmd run test:backend:customer` and `npm.cmd run test:site`; confirm the missing UI/enforcement assertions fail.
- [ ] **Step 3: Implement purpose-state checks** only on optional marketing/service paths; preserve necessary order fulfillment and audit the decision.
- [ ] **Step 4: Add account UI controls** that load server state, submit changes to consent APIs, and display server failures explicitly.
- [ ] **Step 5: Update privacy wording** to specify implemented retention, request channels, and deletion exceptions; avoid promising automatic deletion until implemented.
- [ ] **Step 6: Run** `npm.cmd run test:backend:customer`, `npm.cmd run test:site`, OpenAPI JSON validation, and migration tests; expect persisted UI state and enforcement to match.

### Task 3: Verify automated backup, integrity checks, alerts, and isolated restore (#117)

**Files:**
- Modify only if needed: `scripts/backup.js`, `scripts/postgres-backup.js`, `scripts/backup-scheduler.js`, `.env.example`, `docs/backup-restore-incident-runbook.md`, `docs/production-readiness-checklist.md`
- Test: `tests/backup-runbook.test.js`
- Test: `tests/smoke-monitoring.test.js`

**Interfaces:**
- Consumes: existing `createBackup`, `verifyBackup`, `restoreBackup`, PostgreSQL dump/restore helpers, scheduler and alert webhook.
- Produces: verified scheduled backup behavior, redacted failure alerts, safe restore procedure, and operator evidence checklist.

- [ ] **Step 1: Add failing tests** for required backup storage configuration in production mode, encryption/integrity contract, alert failures, and restore into a fresh isolated database/directory.
- [ ] **Step 2: Run** `node --test tests/backup-runbook.test.js tests/smoke-monitoring.test.js`; confirm gaps.
- [ ] **Step 3: Implement only repository-owned capabilities** that can be validated without selecting a storage vendor; keep provider credentials in environment/secret management and redact errors.
- [ ] **Step 4: Update runbook** with vendor-neutral operator steps, retention, access controls, restore verification, and the RPO/RTO evidence fields already defined.
- [ ] **Step 5: Run** `node --test tests/backup-runbook.test.js tests/smoke-monitoring.test.js`; expect local backup/restore and alert-redaction tests to pass.

**External completion evidence:** Independent cloud storage, storage encryption/access controls, a deployed schedule, and a production-like restore drill require provider selection and operator access. Track these as pending until an isolated restore record is supplied.
