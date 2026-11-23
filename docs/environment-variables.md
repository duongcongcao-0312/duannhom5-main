# Environment configuration

`backend/environment-config.js` is the executable inventory and validation contract. `npm run config:check` loads the local `.env` (if present), validates values, and prints only the environment name and inventory count. The server validates before opening its listener; `npm run predeploy:check` applies the same checks before deployment. Validation errors name the variable and expected format, never its value.

Unless marked required below, variables are optional and use the defaults in `.env.example` or in the owning script. Blank values are treated as unset. The deployment target column describes where a value is consumed; it does not mean that every feature is enabled there.

## Application and deployment variables

| Variable | Type / constraints | Required when | Used by |
| --- | --- | --- | --- |
| `APP_ENV` | `development`, `test`, `staging`, `production` | Optional; defaults from `NODE_ENV`, then development | All services |
| `NODE_ENV` | `development`, `test`, `production` | Production runtime must be `production` | Node runtime |
| `HOST` | Hostname or IP | Optional; loopback locally, `0.0.0.0` in container | Server |
| `PORT` | Integer 1–65535 | Optional; default 8000 | Server |
| `DATABASE_URL` | PostgreSQL URL (contains database credentials; secret) | Staging/production | Backend, migration, backup |
| `EXPECTED_DATABASE_NAME` | Database name | Staging/production with a database URL | Environment isolation |
| `DATABASE_SSL_CA_PATH` | Filesystem path | Only when a private database CA is needed | PostgreSQL TLS |
| `PG_POOL_MAX` | Integer 1–1000 | Optional; default 10 | PostgreSQL |
| `PG_POOL_IDLE_TIMEOUT_MS` | Integer 1–86400000 | Optional; default 30000 | PostgreSQL |
| `PG_POOL_MAX_LIFETIME_SECONDS` | Integer 1–86400 | Optional; default 1800 | PostgreSQL |
| `ADMIN_NAME` | Text | Optional | Admin bootstrap |
| `ADMIN_EMAIL` | Email address (protect as an account identifier) | Staging/production | Admin bootstrap |
| `ADMIN_PASSWORD` | Secret text, at least 12 non-space characters | Staging/production | Admin bootstrap |
| `RATE_LIMIT_HMAC_KEY` | Secret UTF-8 key, at least 32 bytes | Staging/production | Rate limiting |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | Integer 0–32 | Optional; default 0 | Proxy-aware rate limiting |
| `RATE_LIMIT_TRUSTED_PROXY_IPS` | Comma-separated IP addresses | When trusted proxy hops are greater than zero | Proxy-aware rate limiting |
| `API_RATE_LIMIT` | Positive integer | Optional; default 300 | API rate limiting |
| `API_RATE_WINDOW_MS` | Integer 1–86400000 | Optional; default 900000 | API rate limiting |
| `MAX_CONCURRENT_REQUESTS` | Integer 1–1000 | Optional; default 100 | Server |
| `REQUEST_TIMEOUT_MS` | Integer 1000–120000 | Optional; default 30000 | Server |
| `CORS_ORIGINS` | Comma-separated HTTP(S) origins; HTTPS in staging/production | Staging/production | Backend CORS |
| `MONITORING_ALERT_WEBHOOK_URL` | Secret HTTPS URL without embedded credentials | When runtime alerts are enabled | Monitoring |
| `PUBLIC_APP_URL` | HTTP(S) URL | When password reset links are enabled | Account email |
| `SESSION_TTL_MS` | Positive integer milliseconds | Optional; default 8 hours | Sessions |
| `SESSION_IDLE_TIMEOUT_MS` | Non-negative integer milliseconds | Optional; default 2 hours | Sessions |
| `SESSION_REFRESH_TTL_MS` | Positive integer milliseconds | Optional; default 30 days | Sessions |
| `PRIVACY_EXPORT_TTL_MS` | Integer 1–86400000 | Optional; default in privacy export module | Privacy export |
| `PASSWORD_MIN_LENGTH` | Integer 8–128 | Optional; default 12 | Password policy |
| `PASSWORD_MAX_LENGTH` | Integer 12–1024 | Optional; default 128 | Password policy |
| `SESSION_COOKIE_SAMESITE` | `Lax`, `Strict`, or `None` | Optional; default `Lax` | Session cookies |
| `FIREBASE_API_KEY` | Text | When Firebase social sign-in is enabled | Firebase token verification |
| `FIREBASE_PROJECT_ID` | Text | When Firebase project-specific verification is configured | Firebase token verification |

## Payments and email

| Variable | Type / constraints | Required when | Used by |
| --- | --- | --- | --- |
| `PAYMENT_WEBHOOK_SECRET` | Secret, at least 32 bytes when set | Payment webhook signing is enabled | Payment routes |
| `SEPAY_API_KEY` | Secret, at least 16 bytes, no whitespace | Production payment configuration | SePay |
| `SEPAY_BANK_CODE` | Exactly six digits | Production payment configuration | VietQR / SePay |
| `SEPAY_BANK_NAME` | Text, 2–128 characters | Production payment configuration | VietQR |
| `SEPAY_ACCOUNT_NUMBER` | Account identifier; protect as a secret, 6–19 digits | Production payment configuration | VietQR |
| `SEPAY_ACCOUNT_NAME` | Text, 2–128 characters | Production payment configuration | VietQR |
| `SMTP_HOST` | Hostname or IP | SMTP email delivery | SMTP |
| `SMTP_PORT` | Integer 1–65535; default 587 | SMTP email delivery | SMTP |
| `SMTP_FROM` | Email mailbox | SMTP email delivery | SMTP |
| `SMTP_USER` | Secret text | If SMTP authentication is used; set with password | SMTP |
| `SMTP_PASSWORD` | Secret text | If SMTP authentication is used; set with user | SMTP |
| `RESEND_API_KEY` | Secret text | Resend delivery; set with sender | Resend |
| `RESEND_FROM` | Email mailbox | Resend delivery; set with API key | Resend |

## Backup and data operations

| Variable | Type / constraints | Required when | Used by |
| --- | --- | --- | --- |
| `DATA_DIR` | Filesystem path; default `data` | Optional | File storage and backup |
| `BACKUP_DIR` | Filesystem path; default `backups` | Optional; must not overlap `DATA_DIR` | Backup |
| `BACKUP_STATUS_FILE` | Filesystem path | Optional; defaults under `DATA_DIR` | Backup status |
| `BACKUP_INTERVAL_HOURS` | Integer 1–8760; default 24 | Optional | Backup scheduler |
| `BACKUP_RETENTION_DAYS` | Integer 1–3650; default 30 | Optional | Backup retention |
| `BACKUP_LOG_FILE` | Filesystem path | Optional; defaults under `BACKUP_DIR` | Backup scheduler |
| `BACKUP_ALERT_TIMEOUT_MS` | Integer 1–120000; default 10000 | Optional | Backup alerts |
| `BACKUP_ALERT_WEBHOOK_URL` | Secret HTTPS URL without embedded credentials | When backup alerts are enabled | Backup scheduler |
| `DATABASE_BACKUP_TIMEOUT_MS` | Integer 1–86400000; default 1800000 | Optional | PostgreSQL backup |
| `PG_DUMP_PATH` | Executable path or command; default `pg_dump` | Optional | PostgreSQL backup |
| `PG_RESTORE_PATH` | Executable path or command; default `pg_restore` | Optional | PostgreSQL restore |
| `BACKUP_ENCRYPTION_KEY` | Secret canonical base64 encoding of exactly 32 bytes | When encrypted backup is required | Backup encryption |
| `BACKUP_ENCRYPTION_REQUIRED` | Boolean; default false | Optional | Backup encryption |
| `ALLOW_LOCAL_PROD_DB` | Boolean; default false | Only for an explicitly approved local production database | Environment isolation |

## Build, deployment, and operator tools

| Variable | Type / constraints | Required when | Used by |
| --- | --- | --- | --- |
| `API_BASE_URL` | HTTP(S) URL | Optional; frontend build has a public default | Pages build |
| `NODE_VERSION` | Major version integer | Optional; deployment platform | Render blueprint |
| `HOST_PORT` | Integer 1–65535; default 8000 | Optional | Local Compose |
| `SMOKE_BASE_URL` | HTTP(S) URL | Optional; default local backend | Smoke checks |
| `SMOKE_TIMEOUT_MS` | Integer 1–120000; default 5000 | Optional | Smoke checks |
| `SMOKE_ALERT_WEBHOOK_URL` | Secret HTTPS URL | When smoke alerts are enabled | Smoke checks |
| `LOAD_TEST_BASE_URL` | HTTP(S) URL | Optional; default local backend | Load test |
| `LOAD_TEST_STAGING_HOSTS` | Comma-separated hostnames | When staging hosts are allowlisted | Load test |
| `LOAD_TEST_ALLOW_STAGING` | Boolean | Only for an explicitly approved staging run | Load test |
| `LOAD_TEST_REQUESTS` | Positive integer | Optional; load-test profile | Load test |
| `LOAD_TEST_CONCURRENCY` | Positive integer | Optional; load-test profile | Load test |
| `LOAD_TEST_TIMEOUT_MS` | Positive integer milliseconds | Optional; load-test profile | Load test |
| `LOAD_TEST_SLO_P95_MS` | Positive integer milliseconds | Optional; load-test profile | Load test |
| `LOAD_TEST_SLO_ERROR_RATE` | Number 0–1 | Optional; load-test profile | Load test |
| `LOAD_TEST_SLO_THROUGHPUT_RPS` | Non-negative number | Optional; load-test profile | Load test |
| `LOAD_TEST_PROFILE` | `standard` or `spike` | Optional; default standard | Load test |
| `PERF_BASE_URL` | HTTP(S) URL | Optional; performance tool | Frontend performance |
| `PERF_BROWSER` | Executable path | When a non-default browser is needed | Frontend performance |
| `PERF_ITERATION` | Positive integer | Optional; default 1 | Frontend performance |
| `PERF_PAGE` | Page name | Optional | Frontend performance |
| `PERF_VIEWPORT` | Integer width | Optional | Frontend performance |
| `PERF_REPEAT` | Positive integer; default 1 | Optional | Frontend performance |
| `REPO` | `owner/repository` | Optional; default repository | Issue maintenance script |
| `GITHUB_TOKEN`, `GH_TOKEN` | GitHub token secrets | Only when the issue maintenance script calls GitHub | Issue maintenance script |

`NODE_TEST_CONTEXT` and `RENDER` are platform/runtime markers supplied by Node.js or Render, not user configuration inputs. `NODE_TEST_CONTEXT` is used only to avoid loading `.env` in tests.

## Safe configuration and secret storage

- Copy `.env.example` to `.env` for local development. The example contains empty credential slots or local-only values; never paste a real credential into it.
- `.env` and `.env.*` are excluded from Git and Docker build contexts. Keep credentials out of Docker `ARG`, `ENV`, image layers, source files, logs, and issue comments. Supply them at runtime through the platform's environment/secret facility.
- On Render, put credentials in the service's Environment settings as secret values; use Secret Files only for certificates such as a database CA. The checked-in Render blueprints mark credentials `sync: false` and do not store their values.
- In GitHub Actions, put credentials in repository or environment **Secrets**. Use **Variables** only for public non-secret settings such as `API_BASE_URL`. Limit secret access to the workflows and environments that need it.
- For local operations, use the ignored `.env` file or the shell's process environment; do not persist production credentials on a developer machine.
- If a credential is exposed, revoke/rotate it at its provider, replace the secret-manager value, and redeploy. Deleting the visible copy alone does not revoke it.

Run `npm run config:check` for the local environment and `npm run predeploy:check` before deploying. Both report variable names and validation reasons, never secret values.
