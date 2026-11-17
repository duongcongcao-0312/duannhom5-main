# P1 Release and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make required checks, deployment gates, runtime readiness, and monitoring verifiable for issues #122–#124.

**Architecture:** Extend the existing single `ci-gate`, Render blueprint, pre-deploy validation, health/readiness, smoke monitor, structured logs, and audit facilities. Keep GitHub account-level branch protection and production approvals as explicit administrator actions.

**Tech Stack:** GitHub Actions, Render blueprint, Node.js 20, PostgreSQL, existing smoke/monitoring scripts and `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-18-issues-109-127-design.md`

## Global Constraints

- CI must fail closed on test, migration, secret scan, dependency scan, OpenAPI, or build failures.
- Production deploy must require approval; staging/production secrets remain in provider-managed secret stores.
- `/health` is liveness; `/ready` checks required persistence dependencies.
- Logs and alerts must redact secrets and avoid unnecessary PII.
- Do not claim branch protection, staging stability, or provider alerts are active without account-level evidence.
- Do not commit unless the user explicitly asks.

## Review Focus

- A skipped or misconfigured CI job must not satisfy the required check; test workflow conditions and job dependencies.
- Missing environment variables must fail preflight without printing values; test absent and malformed values.
- Database outage must make readiness fail while liveness stays available; test both statuses.
- Alert payloads must not include request bodies or credentials; test redaction with synthetic secrets.
- Production approval must be required even if staging auto-deploy succeeds; verify workflow/environment configuration and document required GitHub settings.

---

### Task 1: Complete required CI gates and deployment protections (#122)

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/workflows/container.yml` as necessary
- Test: `tests/predeploy-check.test.js`, `tests/migrations.test.js`, `tests/postgres-integration.test.js`
- Update: `docs/ci-gates.md`

**Interfaces:**
- Consumes: current `ci-gate`, PostgreSQL service, npm scripts, test reports, and deployment workflows.
- Produces: required secret/dependency/API/migration/test checks and approval-gated production deployment.

- [ ] **Step 1: Add workflow validation tests or static checks** for secret scan, dependency audit, test database, OpenAPI/migration checks, and deploy jobs depending on the required CI job.
- [ ] **Step 2: Run** `node --test tests/predeploy-check.test.js tests/migrations.test.js tests/postgres-integration.test.js`; expected gaps should be explicit.
- [ ] **Step 3: Update CI and deploy workflows** so all gates run before build/publish/deploy, artifacts contain only sanitized reports, and production jobs target a protected GitHub Environment.
- [ ] **Step 4: Update CI documentation** with exact required check names and admin steps to configure branch protection/rulesets.
- [ ] **Step 5: Run** workflow syntax validation, `npm.cmd run check`, focused workflow-related tests, and CI-equivalent commands; verify failed gates block downstream deploy jobs.

### Task 2: Verify staging/production preflight, health, readiness, rollback, and smoke (#123)

**Files:**
- Modify as needed: `scripts/predeploy-check.js`, `server.js` or extracted health routes, `render.yaml`, `.env.example`
- Test: `tests/predeploy-check.test.js`
- Test: `tests/smoke-monitoring.test.js`
- Test: `tests/backend-runtime.test.js`
- Update: `docs/production-readiness-checklist.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: required environment validation, `/health`, `/ready`, Render start command, and `npm run smoke`.
- Produces: fail-fast config checks, accurate liveness/readiness, documented rollback and post-deploy verification.

- [ ] **Step 1: Add failing tests** for missing/malformed required production config, dependency unavailable at readiness, liveness independence, and smoke failure reporting.
- [ ] **Step 2: Run** `node --test tests/predeploy-check.test.js tests/smoke-monitoring.test.js tests/backend-runtime.test.js`; confirm expected gaps.
- [ ] **Step 3: Implement missing fail-fast/readiness behavior** without exposing environment values; keep the health response independent of database readiness.
- [ ] **Step 4: Document reversible deploy/rollback steps**, migration compatibility requirements, Render environment setup, cold-start/timeouts, and exact smoke commands.
- [ ] **Step 5: Run** the three focused test files plus `npm.cmd run predeploy:check` and `npm.cmd run smoke` against a local test server; expected status codes and safe error output pass.

### Task 3: Complete monitoring, metrics, alerts, and admin audit (#124)

**Files:**
- Modify as needed: `server.js`, `backend/audit.js`, `scripts/smoke-test.js`, `scripts/backup-scheduler.js`
- Test: `tests/smoke-monitoring.test.js`
- Test: `tests/backup-runbook.test.js`
- Test: `tests/security-hardening.test.js`
- Update: operational runbook

**Interfaces:**
- Consumes: request IDs, structured error logs, audit hash chain, health/readiness and existing webhook alert mechanisms.
- Produces: measured operational signals, redacted alerts, and runbook response steps.

- [ ] **Step 1: Add failing tests** for request correlation, duration/status metrics, payment/backup failure events, alert redaction, and audit coverage for sensitive admin changes.
- [ ] **Step 2: Run** `node --test tests/smoke-monitoring.test.js tests/backup-runbook.test.js tests/security-hardening.test.js`.
- [ ] **Step 3: Add bounded, low-cardinality metrics and alert events** using existing infrastructure; avoid logging email, token, body, or connection string values.
- [ ] **Step 4: Update incident runbook** with each signal, threshold owner, alert route, and first-response action; keep dashboard-provider configuration external.
- [ ] **Step 5: Run** the focused tests and verify injected secret/PII values are absent from captured logs and alert payloads.

**External completion evidence:** Branch protection/ruleset, GitHub Environment approvers, staging deployment, monitoring dashboards/alerts, and rollback rehearsal need repository/provider-admin access and recorded evidence.
