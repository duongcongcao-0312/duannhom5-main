# BookNest system architecture

## Overview

BookNest is a static HTML/CSS/JavaScript storefront backed by a Node.js HTTP
server. The server serves the storefront when running locally and exposes the
REST API under `/api`. GitHub Pages serves only the built frontend; it cannot
run the Node.js API or persist backend data.

```text
Browser
  |-- static pages and assets (local Node server or GitHub Pages)
  |-- same-origin /api requests locally
  `-- HTTPS API requests when frontend and backend are deployed separately
          |
          +-- PostgreSQL when DATABASE_URL is configured
          `-- JSON/JSONL files for local/demo fallback
```

## Frontend

- `index.html`, `book.html`, and `admin.html` provide the storefront, book
  detail, and administration UI.
- `main.js`, `book-detail.js`, and `admin.js` implement browser behavior.
- `assets/api-client.js` applies the configured backend origin and common
  request behavior. `assets/api-config.js` provides the normal static-site API
  origin; `scripts/build-pages.js` writes the build-time `API_BASE_URL` into
  `dist/assets/api-config.js`.
- The frontend does not authoritatively calculate order prices or permissions.
  The backend validates submitted products, recalculates totals and checks
  authorization.
- `localStorage` is used for cart, favorites, coupon selection and some
  service-request drafts. `sessionStorage` holds the bearer token and temporary
  account/contact presentation data. These browser stores are not backend
  persistence or backup.

The optional Firebase Web app configuration in `assets/firebase-config.js` is
public client configuration, not a place for service-account keys or provider
secrets. Google/Facebook sign-in uses Firebase Authentication; the backend
verifies Firebase ID tokens using `FIREBASE_API_KEY`.

## Backend and API

`server.js` is the HTTP entry point. It loads `.env` via `dotenv`, initializes
the selected persistence adapter and auth/session store, and serves the API.
Routes are implemented in the server and supporting modules under `backend/`.
The machine-readable contract is [docs/openapi.json](docs/openapi.json).

Important public routes include:

- `GET /health` for process liveness and `GET /ready` for readiness.
- `GET /api/books`, `GET /api/coupons/{code}`, and `POST /api/orders/quote`.
- `POST /api/orders` and `POST /api/services`.
- `GET /api/payments/config` to provide public bank-transfer display details.
- Account registration/login, password reset and optional social auth under
  `/api/auth`.

Administrative routes under `/api/admin` check backend permissions; hiding
controls in the browser is not authorization. Authenticated requests use a
Bearer token. Passwords are hashed with scrypt. Browser bearer tokens are held
in `sessionStorage`; the application does not use authentication cookies.
Session lifetime defaults to 8 hours, with a 30-day refresh window. PostgreSQL
stores shared sessions in `auth_sessions`; without a database, local sessions
are held in process memory and do not survive a restart.

## Persistence and migrations

When `DATABASE_URL` is absent, the local/demo adapter in `backend/db.js` stores
records as JSON or JSONL below `data/`. The PostgreSQL adapter in
`backend/postgres-db.js` is selected when `DATABASE_URL` is set. Production
deployments should use PostgreSQL so orders, inventory, sessions and webhook
deduplication share durable state across instances.

PostgreSQL schema changes are ordered in `data/migrations/` and tracked in
`schema_migrations`. Run `npm run migrate` with the target `DATABASE_URL` before
serving traffic. The Render blueprint runs
`npm run predeploy:check && npm run migrate && npm start`; migrations are not
reversed automatically during an application rollback. Back up the database
before releases and follow [the deployment guide](docs/deployment.md) and
[the backup/restore runbook](docs/backup-restore-incident-runbook.md).

## Order and payment flow

1. The browser requests a quote; the server validates item titles and
   quantities against its catalog and applies eligible account/coupon
   discounts.
2. On order creation, the server recalculates trusted values. With PostgreSQL,
   idempotency and inventory reservation are coordinated transactionally.
3. For bank transfer, the browser gets account details from
   `GET /api/payments/config` and requests a QR image from VietQR. The QR image
   request includes bank/account display data, amount and order payment code.
4. If configured, `POST /api/payments/sepay-webhook` authenticates SePay with
   `Authorization: Apikey ...` and matches an incoming transfer to a transfer
   order using its payment code, receiving account and exact amount. PostgreSQL
   is required for idempotent event application.
5. `POST /api/payments/webhook` is a separate BookNest HMAC-SHA256 contract,
   signed over the raw JSON request body using `PAYMENT_WEBHOOK_SECRET`.

These features do not initiate a bank debit or call a payment provider to
collect funds. A configured QR or webhook alone is not proof of end-to-end
payment processing; validate the real provider callback in a controlled
environment before relying on automatic status updates.

## Privacy data model

The authenticated `/api/privacy/consents` endpoints can store and revoke
purpose/version/source/retention metadata. The current storefront does not
automatically collect these consent records or block order/service submission
based on them. `retentionDays` is recorded metadata, not an automatic deletion
schedule. See [privacy.html](privacy.html); production operators must establish
and publish retention and request-handling procedures before using real
personal data.

## Deployment and quality checks

- Local development: `npm ci`, copy `.env.example` to `.env`, configure a
  unique admin credential, then `npm start`.
- Static site: `npm run build:pages`; deploy `dist/` and set `API_BASE_URL` in
  the build environment if the backend origin differs from the configured
  default.
- Render: `render.yaml` provisions a Node service, runs pre-deploy validation
  and PostgreSQL migrations, and checks `/ready`.
- Docker: the image exposes port 8000 and declares `/app/data` as a volume for
  file-storage mode.

Useful checks are `npm run check`, `npm test`, `npm run build:pages`,
`npm run predeploy:check`, and `npm run smoke`. Test coverage, required runtime
versions and CI gates are described in [docs/ci-gates.md](docs/ci-gates.md).
