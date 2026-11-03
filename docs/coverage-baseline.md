# Coverage baseline

Baseline recorded on 2026-11-03 with `npm run test:coverage`.

The run completed **93 tests: 92 passed, 1 skipped, 0 failed**. The skipped test
requires a PostgreSQL `DATABASE_URL`.

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| All files | 83.43% | 71.41% | 93.19% | 83.43% |
| `server.js` | 82.92% | 72.81% | 92.30% | 82.92% |
| `backend/auth.js` | 84.32% | 71.42% | 81.81% | 84.32% |
| `backend/db.js` | 79.44% | 67.64% | 92.30% | 79.44% |
| `backend/email.js` | 87.77% | 75.75% | 83.33% | 87.77% |
| `backend/postgres-db.js` | 88.78% | 63.81% | 97.29% | 88.78% |
| `backend/router.js` | 100% | 100% | 100% | 100% |
| `books-data.js` | 100% | 100% | 100% | 100% |
| `scripts/backup.js` | 68.99% | 75% | 83.33% | 68.99% |

CI continues to enforce at least 70% line, 65% branch, and 60% function
coverage. It also uploads `test-results.xml` and `coverage/lcov.info` as the
`test-reports` workflow artifact.
