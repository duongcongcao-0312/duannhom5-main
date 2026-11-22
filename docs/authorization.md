# Authentication and authorization

## Trust boundaries

- Protected API requests use a bearer token in `Authorization`; the backend
  resolves the token to a server-side session and takes `userId` and `role`
  from that session.
- Public registration accepts profile fields only and always creates a
  `user`. It rejects client-supplied `role` and order `userId` fields.
- Staff accounts are provisioned by an authorized admin and may only receive
  the `sales` or `support` roles. User verification updates do not grant roles.
- The browser cart is local state; there is no backend cart endpoint. Checkout
  recalculates order totals and associates authenticated orders with the
  session user, not a request payload.

## Endpoint access

| Endpoint | Access rule |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/social`, `/password-reset*` | Public entry points; credentials or social identity are verified server-side. |
| `GET /api/auth/me`, `PATCH /api/auth/customer-info`, `/api/auth/logout` | Authenticated session; profile changes apply only to that session's user. See [Personal data updates](#personal-data-updates). |
| `/api/privacy/consents*`, `/api/privacy/data-requests`, `/api/privacy/exports*` | Authenticated session; consent, request, and personal data export records are strictly scoped to the session user ID. See [Personal data export](#personal-data-export). |
| `GET /api/books`, `GET /api/coupons/:code`, `GET /api/policies/terms`, `GET /api/policies/shipping`, `GET /api/policies/return`, `GET /api/policies/refund`, `POST /api/services`, `POST /api/orders/quote` | Public catalog, coupon lookup, terms/shipping/return/refund policies, service request, or quote. |
| `POST /api/orders` | Guest or authenticated checkout. Authenticated order ownership is assigned from the session; client `userId` is rejected. |
| `GET /api/orders` | Authenticated; returns only orders owned by the session user. |
| `GET /api/orders/:id` and `GET /api/orders/:id/status` | Account orders require the owner or admin. Guest checkout tracking remains available by the unguessable order UUID; treat it as a bearer lookup secret. |
| `PATCH` / `PUT /api/orders/:id` | Authenticated owner may cancel only when the status transition permits it; only admin can perform staff-level changes or set payment status. |
| `PATCH` / `PUT` `/api/admin/orders/:id` | `write:orders`; sales may update workflow status but cannot set `paymentStatus`. Only admin or the verified payment webhook may confirm payment. |
| `/api/payments/sepay-webhook` | Provider API key required; the event is matched to the receiving account, payment code, and order amount. |
| `/api/admin/*` | Permission checked server-side. Unknown admin routes fail closed. |
| `/api/customers*` and `/api/admin/customers*` | CRM permission matrix below; the `/api/admin` prefix does not bypass permission checks. |

## Staff permission matrix

| Capability | Customer | Support | Sales | Admin |
| --- | --- | --- | --- | --- |
| Dashboard | — | — | Read | Read |
| Orders | Own orders only | — | Read/update status | Read/update |
| Services | — | Read/update | Read/update | Read/update |
| Books and coupons | Public catalog only | — | — | Read/write |
| Users and staff management | — | — | — | Read/write |
| CRM customer records | — | Read | Read/create/update | Read/create/update/delete |
| CRM interactions | — | Read/create | Read/create/update | Read/create/update/delete |

CRM permissions and admin API permissions are defined in
`backend/authorization.js`. Role changes and deactivation are restricted to
admin-only staff management; updated staff sessions are revoked.

## Audit trail

Sensitive API requests and all `/api/admin/*` requests append an audit event
with request ID, route, method, and the authenticated actor when available.
The event is recorded before route handling, so denied attempts are captured
too. Domain events record profile changes, order status changes, student
verification, staff changes, and CRM/customer interaction changes in both
file-backed and PostgreSQL storage modes. Audit payloads omit personal contact
fields, credentials, and tokens.

The audit file is selected with `auditLogPath` in tests or defaults to
`data/admin-audit.jsonl` for the application. The admin audit endpoint requires
the `read:users` permission.

## Personal data updates

Policy lives in `backend/profile-update.js` and is enforced by
`PATCH /api/auth/customer-info`. The public description is in
`privacy.html#profileUpdatePolicy`.

| Field group | Fields | Rule |
| --- | --- | --- |
| Self-service | `customerName`, `name`, `phone`, `address` | Validated server-side (name 2–120, phone 8–15 digits, address 10–300). |
| Confirmation required | replacing a saved `phone` | `currentPassword` re-authentication (rate limited), or a login within 10 minutes for social-only accounts. Otherwise `428` with `code` `REAUTH_REQUIRED` / `RECENT_LOGIN_REQUIRED`. |
| Additional verification | `email`, `password`, `studentType`, `studentId`, `role`, social links, `userId` | Rejected with `403 VERIFICATION_REQUIRED`; use password reset, social link/unlink, support, or a privacy "update" data request. |

- Ownership: the target account is always the session user; payload IDs are rejected.
- Duplicates: a phone already stored on another active account returns
  `409 PHONE_IN_USE`; resubmitting identical values (phone compared by digits)
  is a no-op with no write or audit entry.
- Orders: existing orders keep the delivery snapshot captured at checkout
  (`ordersUpdated: 0`); new orders use the updated profile.
- Audit: `user.customer_info.update` records only `changedFields` and the
  `confirmation` method (`none`, `password`, `recent_login`), never values.

## Personal data export

Policy and short-lived download store live in `backend/privacy-export.js` and
are enforced by `GET/POST /api/privacy/exports` and
`GET /api/privacy/exports/:id/download`. The public description is in
`privacy.html#profileExportPolicy`.

- **Identity & ownership verification:** requires an authenticated session plus
  `currentPassword` re-authentication (rate limited), or a login within 10
  minutes for social-only accounts. Forged target IDs are rejected.
- **Included scope (UTF-8 JSON):** account profile, saved `customerInfo`,
  orders strictly matching `order.userId === session.userId`, consent records,
  and privacy data requests.
- **Excluded data:** passwords, reset/session tokens, raw social `providerId`,
  other users' and guest orders, anonymous service requests, internal CRM
  records/notes, staff actor IDs, and admin audit logs.
- **Download protection & expiry:** downloads require both the owner's bearer
  session and the one-time `X-Export-Token` header. Payloads expire after 15
  minutes (returning `410 EXPORT_EXPIRED` and purging payload bytes).
- **Duplicate prevention & minimal audit:** only one active non-expired export
  is allowed per account (`409 EXPORT_ALREADY_ACTIVE`), plus rate limiting.
  `privacy.export.create` and `privacy.export.download` log only metadata
  (format, counts, byte length, confirmation method), never PII or tokens.

## Data-subject request workflow (DSAR)

Policy and workflow helpers live in `backend/privacy-data-requests.js`,
documented operationally in `docs/privacy-request-procedure.md` and publicly
in `privacy.html#privacyRequestProcedure`.

- **Types & internal SLA:** `access`, `update`, `export` (48h) and `delete`
  (72h). Each request records `channel`, `verificationMethod`, `dueAt`,
  `overdue`, `assignedTo`, `escalationLevel` (`l1_support` →
  `l2_privacy_lead` → `l3_legal_admin`), and structured `resolutionCode`.
- **Admin queue (`GET/PATCH /api/admin/privacy/data-requests`):** requires
  `read:privacy` / `write:privacy`, supports filtering by `status`, `type`,
  `escalationLevel`, and `overdue`, and never stores free-text PII `details`.
- **Approved anonymization:** completing a `delete` request with
  `executeAnonymization: true` anonymizes personal account fields, disables
  login, and revokes all active sessions for that user while keeping historical
  order records intact for accounting reconciliation.
