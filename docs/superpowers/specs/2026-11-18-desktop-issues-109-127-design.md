# Issues #109–#127 Desktop Completion Design

## Intent

Audit the current desktop working copy and safely complete the missing repository work for GitHub Issues #109–#127, prioritizing P0, then P1, then P2. Preserve all staged, unstaged, and untracked work already present; do not restore staged content into the working tree or reset files.

## Current State

- The working tree contains substantial staged and unstaged changes that disagree. `server.js` remains the active monolithic entry point; `backend/app.js` is present but imports empty route stubs. Several migration, plan, and design files are zero bytes in the working tree.
- `npm.cmd run check` passes. `npm.cmd test` currently reports 150 passing, 5 failing, and 2 skipped tests. Failures are in password-reset mailer setup, catalog retry after database failure, CORS credentials expectations, and two pre-deploy cases that do not supply the now-required SePay fields.
- `npm.cmd audit --omit=dev` reports no production dependency vulnerabilities. Gitleaks is not installed locally; no secret-scanning step is present in the current CI workflow.
- SePay validation exists in `backend/sepay-config.js` and production preflight, but `.env.example` and `render.yaml` do not yet define the required SePay environment keys.
- Authentication/ownership checks, business pricing and inventory logic, webhook handling, security headers, consent persistence, database migrations, backup scheduling, OpenAPI documentation, health checks, and structured logging already have implementation or tests. Their remaining work is to restore green regressions, close concrete gaps, and document operational dependencies—not duplicate existing systems.
- Consent UI/data-request handling, enforced retention, verified encrypted/off-site backup, full route modularization, OpenAPI schema validation, Playwright E2E, load testing, GitHub branch rules, production secret rotation, and provider-level staging/monitoring setup are incomplete or require external access.

## Goals

- Preserve the current desktop working copy and make incremental changes against its actual state.
- Keep P0 controls fail-closed and test security boundaries before expanding P1/P2.
- Add focused regression tests before production behavior changes.
- Keep secrets, live customer data, and production credentials out of the repository and test output.
- Mark actions requiring Render, GitHub administration, SePay, or backup-provider access as external operator steps.

## Non-goals

- Do not overwrite or restore the current unstaged working copy from the Git index.
- Do not rotate/revoke live credentials, modify provider dashboards, enable branch protection, conduct live payment tests, or create production infrastructure without authorized provider access.
- Do not claim production readiness based only on local tests or documentation.
- Do not perform a broad rewrite before the existing regression failures and module boundaries are understood.

## Approaches

1. Restore the staged version as the source of truth and continue it. Rejected because the user explicitly chose to preserve the current working copy.
2. Replace the backend and deployment setup with a clean rewrite. Rejected because it risks losing already-present behavior and is unnecessary for the identified gaps.
3. Implement incrementally against the current working tree, by priority and bounded subsystem, keeping the existing server behavior and adding tests at each step. Chosen by the user because it preserves current work while allowing missing items to be completed safely.

## Design

1. Treat the current working tree as authoritative and do not stage, reset, or restore files as a workaround.
2. First diagnose and fix the five failing tests; preserve any baseline skip as a skip unless a dedicated PostgreSQL service is available.
3. Complete repository-controlled P0 work: secret scanning in CI and safe sample configuration; strict SePay configuration in Render blueprint; focused tests for identity/ownership, pricing/inventory, payment reconciliation, session, CSP, and CORS.
4. Complete repository-controlled P1 work: relational migration/integration checks, consent UI and data-subject request lifecycle, retention behavior, encrypted backup support, safe modularization, OpenAPI validation, and test coverage.
5. Complete repository-controlled P2 work: reproducible performance/load-test tooling and accurate technical/runbook documentation.
6. Report separately all provider/account actions still needed, with no assertion that they were performed locally.

## Constraints and Decisions

- Continue on the current `main` checkout; preserve existing staged, unstaged, and untracked files.
- Use the existing Node.js `node:test` suite and project conventions.
- Do not add a production secret or real personal/payment data to configuration, fixtures, logs, or generated documentation.
- Use test-first development for behavior changes.
- No dependency or production deployment changes without a focused need and validation.
- The target 80% coverage applies to agreed business-critical modules; do not raise a global threshold without checking current measured coverage and feasibility.
- Payment configuration values may be present as empty placeholders or Render `sync: false` declarations; actual values must be supplied by an authorized operator.
- Credential rotation, GitHub secret-scanning settings/branch rules, real staging, external backup storage, and real SePay end-to-end testing need account access and are not represented as complete by code changes alone.

## Open Operator Dependencies

- Revoke and replace any exposed credentials at their actual providers, then confirm production values are stored only in their secret manager.
- Enable GitHub repository secret scanning/push protection and required branch rules where the repository plan permits.
- Supply SePay production settings to Render and perform a provider-approved sandbox/staging transaction.
- Provision a separate staging environment and an encrypted, access-controlled off-site backup destination.
- Run and record restore and production rollback drills, plus monitoring dashboard/alert verification.
