# SDD ledger — plan: docs/superpowers/plans/2026-11-18-issues-101-108-implementation.md

Pre-flight: Tasks 1/5/7 share the checkout payment/idempotency interface; Task 3 shares customer identity/storage with Task 4; Task 6 shares readiness/configuration with Task 8. Existing payment and deployment helpers are present but frontend integration and some validation remain incomplete.

Ruling: Work directly on the current `main` checkout because the user explicitly declined a worktree — cost if wrong: unrelated local changes remain in the same workspace and must be kept separate.

Baseline: `npm.cmd test` currently fails 58 of 149 tests before implementation, including existing auth, validation, payment, and production-startup tests.

Task 1: complete — payment UI now loads `/api/payments/config`, renders backend bank details, and no longer contains the real account in HTML/JS; `npm.cmd run test:site -- --test-name-pattern="server entrypoint|payment UI contains COD"` and `npm.cmd run test:backend:payment` pass.

Ruling: Restored `server.js` from clean parent commit `c877459^` because HEAD contained an empty/conflicted server entrypoint and the repository's existing tests and payment API contract require it — cost if wrong: this reintroduces the last clean server implementation and may include pre-existing behavior that should later be reviewed separately.

Task 2: complete — public quick-login profiles now use synthetic `example.com` identities and are labeled as simulated data; the focused site suite passes.

Task 3: complete — consent records now persist in file/PostgreSQL storage, expose authenticated record/list/revoke endpoints, have migration 008, OpenAPI documentation, privacy-policy alignment, and integration coverage.

Task 4: complete — current-user and customer contact data now use `sessionStorage` and are removed on logout; cart/favorites remain persistent.

Task 5: complete — the browser API client retries only safe GET/HEAD/OPTIONS requests twice for cold-start 5xx/network failures and never automatically replays writes.

Task 6: complete — production pre-deploy validation now requires a valid PostgreSQL `DATABASE_URL`; existing health/readiness and deployment documentation remain in place.

Tasks 7/8: existing webhook authentication/idempotency/amount reconciliation and CI release gates were verified by the payment/site suites and workflow configuration; no duplicate implementation was added.

Verification: focused site (50/50), customer (6/6), payment (2/2), pre-deploy/migration (6 passed, 1 PostgreSQL integration skip), and OpenAPI JSON validation pass. Full `npm.cmd test` now reports 152 passed, 2 skipped, and 2 pre-existing failures in password-reset mailer setup and CORS credentials expectation.
