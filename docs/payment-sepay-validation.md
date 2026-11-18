# SePay production configuration and validation

## Required configuration

The Render blueprint declares the following values as `sync: false`, so
operators must provide them through the Render service's environment settings.
Do not put real values in this repository, screenshots, issue comments, or test
fixtures.

| Variable | Requirement |
| --- | --- |
| `SEPAY_API_KEY` | At least 16 UTF-8 bytes; no whitespace. |
| `SEPAY_BANK_CODE` | Six-digit VietQR bank BIN. |
| `SEPAY_BANK_NAME` | 2–128 characters; no control characters. |
| `SEPAY_ACCOUNT_NUMBER` | 6–19 digits. |
| `SEPAY_ACCOUNT_NAME` | 2–128 characters; no control characters. |

Render's start command runs `npm run predeploy:check` before migrations and
server startup. In production, the check rejects each missing or malformed
SePay value and names only the invalid variable; it never includes the
configured value in its error.

## Local automated validation

The test fixtures use synthetic account information and a local database
adapter. No provider credentials or real payment data are used.

```sh
node --test tests/backend-payment.test.js tests/predeploy-check.test.js tests/postgres-db.test.js
```

Result: **24 passed, 0 failed**.

The tests verify that:

- the public payment-config API returns the configured QR display fields, not
  the SePay API key;
- QR amount and payment code match a newly created transfer order;
- a valid simulated SePay callback applies only to the matching transfer
  order;
- mismatched amounts and unknown payment codes are ignored before database
  reconciliation;
- missing keys and non-BIN bank codes fail clearly;
- production pre-deploy validation rejects each missing SePay setting and
  malformed values;
- PostgreSQL applies payment events idempotently and validates order amount and
  payment status transactionally.

These are local automated tests, not a SePay provider sandbox transaction.

## Staging procedure

Run this only in an isolated Render staging service configured with provider
sandbox credentials and a non-production receiving account:

1. Add the five required values through the Render Dashboard. Never copy them
   into the repository or the test report.
2. Deploy and confirm the pre-deploy check passes before the migration and
   server start.
3. Request `GET /api/payments/config`; confirm the returned bank BIN,
   account number, bank name, and account name match the staging account. The
   response must not contain `SEPAY_API_KEY`.
4. Create a transfer order and verify the QR uses its exact total and generated
   `BN...` payment code.
5. Configure the SePay sandbox callback to
   `POST /api/payments/sepay-webhook`, complete one sandbox transfer, then
   confirm `GET /api/orders/{orderId}/status` reports `paymentStatus: "paid"`.
6. Retry the same callback and confirm it is handled idempotently. In a
   sandbox fixture, verify a wrong amount, receiving account, or payment code
   does not mark the order paid.
7. In a separate preview deployment, omit each required variable one at a
   time and verify `npm run predeploy:check` fails before startup.

## Current external-validation status

The repository does not contain SePay sandbox credentials or a staging
receiving account, and no provider sandbox transaction was run for this
change. Do not treat the local simulated webhook tests as confirmation of
provider connectivity or a completed bank transfer. Record the Render staging
deployment ID, callback outcome, and sanitized order status here after an
authorized sandbox run; omit API keys, account numbers, names, and real
customer/order data.
