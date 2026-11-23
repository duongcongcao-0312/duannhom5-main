-- BN-005: Clean/normalize existing duplicates safely before enforcing unique constraints
-- for email, order/payment codes, and payment transaction references.

-- 1. Normalize active customer emails and soft-deactivate any case-insensitive duplicates
--    (keeping the earliest created active record).
WITH ranked_customers AS (
  SELECT
    customer_id,
    ROW_NUMBER() OVER (PARTITION BY lower(BTRIM(email)) ORDER BY created_at ASC, customer_id ASC) AS rn
  FROM customers
  WHERE is_active = TRUE
)
UPDATE customers c
SET
  is_active = FALSE,
  deleted_at = COALESCE(c.deleted_at, NOW()),
  updated_at = NOW()
FROM ranked_customers rc
WHERE c.customer_id = rc.customer_id
  AND rc.rn > 1;

UPDATE customers
SET email = lower(BTRIM(email))
WHERE email <> lower(BTRIM(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_lower_email_active
  ON customers (lower(email))
  WHERE is_active = TRUE;

-- Ensure case-insensitive unique email index on app_users
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_lower_email
  ON app_users (lower(email));

-- 2. Dedicated payment_code column on store_orders with safe backfill & uniqueness
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS payment_code VARCHAR(32);

WITH extracted_codes AS (
  SELECT
    order_id,
    upper(BTRIM(COALESCE(payment_code, legacy_record->>'paymentCode', ''))) AS norm_code,
    ROW_NUMBER() OVER (
      PARTITION BY upper(BTRIM(COALESCE(payment_code, legacy_record->>'paymentCode', '')))
      ORDER BY created_at ASC, order_id ASC
    ) AS rn
  FROM store_orders
  WHERE BTRIM(COALESCE(payment_code, legacy_record->>'paymentCode', '')) <> ''
)
UPDATE store_orders o
SET payment_code = CASE WHEN ec.rn = 1 THEN ec.norm_code ELSE NULL END
FROM extracted_codes ec
WHERE o.order_id = ec.order_id
  AND (o.payment_code IS DISTINCT FROM (CASE WHEN ec.rn = 1 THEN ec.norm_code ELSE NULL END));

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_orders_payment_code_unique
  ON store_orders (upper(payment_code))
  WHERE payment_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_orders_idempotency_key_unique
  ON store_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Dedicated transaction_ref column on payment_webhook_events with safe deduplication & uniqueness
ALTER TABLE payment_webhook_events
  ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

WITH ranked_tx AS (
  SELECT
    event_id,
    ROW_NUMBER() OVER (
      PARTITION BY BTRIM(transaction_ref)
      ORDER BY received_at ASC, event_id ASC
    ) AS rn
  FROM payment_webhook_events
  WHERE transaction_ref IS NOT NULL AND BTRIM(transaction_ref) <> ''
)
UPDATE payment_webhook_events p
SET transaction_ref = NULL
FROM ranked_tx rt
WHERE p.event_id = rt.event_id
  AND rt.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_tx_ref_unique
  ON payment_webhook_events (transaction_ref)
  WHERE transaction_ref IS NOT NULL;
