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
| `GET /api/auth/me`, `PATCH /api/auth/customer-info`, `/api/auth/logout` | Authenticated session; profile changes apply only to that session's user. |
| `/api/privacy/consents*` | Authenticated session; consent records use the session user ID. |
| `GET /api/books`, `GET /api/coupons/:code`, `POST /api/services`, `POST /api/orders/quote` | Public catalog, coupon lookup, service request, or quote. |
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
