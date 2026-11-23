-- BN-007: Backfill unintended NULLs safely before enforcing NOT NULL / defaults,
-- while preserving intentionally nullable optional columns (guest user_id, coupon_code,
-- social auth_provider/provider_id, optional customer demographics, open DSAR resolution).

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN;

UPDATE app_users
SET
  email_verified = COALESCE(
    email_verified,
    CASE
      WHEN lower(COALESCE(legacy_record->>'emailVerified', '')) = 'true' THEN TRUE
      ELSE FALSE
    END
  ),
  is_active = COALESCE(
    is_active,
    CASE
      WHEN lower(COALESCE(legacy_record->>'isActive', '')) = 'false' THEN FALSE
      ELSE TRUE
    END
  ),
  full_name = CASE WHEN BTRIM(COALESCE(full_name, '')) = '' THEN 'BookNest user' ELSE full_name END
WHERE email_verified IS NULL OR is_active IS NULL OR BTRIM(COALESCE(full_name, '')) = '';

ALTER TABLE app_users
  ALTER COLUMN email_verified SET DEFAULT FALSE,
  ALTER COLUMN email_verified SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN is_active SET NOT NULL;

UPDATE privacy_data_requests
SET due_at = COALESCE(
  due_at,
  CASE
    WHEN request_type IN ('access', 'export') THEN COALESCE(created_at, NOW()) + INTERVAL '3 days'
    ELSE COALESCE(created_at, NOW()) + INTERVAL '15 days'
  END
)
WHERE due_at IS NULL;

ALTER TABLE privacy_data_requests
  ALTER COLUMN due_at SET DEFAULT (NOW() + INTERVAL '15 days'),
  ALTER COLUMN due_at SET NOT NULL;

UPDATE store_orders
SET
  customer_name = CASE WHEN BTRIM(COALESCE(customer_name, '')) = '' THEN 'Khách hàng BookNest' ELSE customer_name END,
  phone = CASE WHEN BTRIM(COALESCE(phone, '')) = '' THEN '0000000000' ELSE phone END,
  address = CASE WHEN BTRIM(COALESCE(address, '')) = '' THEN 'Chưa cập nhật địa chỉ' ELSE address END
WHERE BTRIM(COALESCE(customer_name, '')) = ''
   OR BTRIM(COALESCE(phone, '')) = ''
   OR BTRIM(COALESCE(address, '')) = '';

ALTER TABLE store_orders
  DROP CONSTRAINT IF EXISTS store_orders_required_text_non_empty,
  ADD CONSTRAINT store_orders_required_text_non_empty
    CHECK (BTRIM(customer_name) <> '' AND BTRIM(phone) <> '' AND BTRIM(address) <> '');

UPDATE service_requests
SET
  book_title = CASE WHEN BTRIM(COALESCE(book_title, '')) = '' THEN 'Chưa rõ tên sách' ELSE book_title END,
  customer_name = CASE WHEN BTRIM(COALESCE(customer_name, '')) = '' THEN 'Khách hàng BookNest' ELSE customer_name END,
  phone = CASE WHEN BTRIM(COALESCE(phone, '')) = '' THEN '0000000000' ELSE phone END
WHERE BTRIM(COALESCE(book_title, '')) = ''
   OR BTRIM(COALESCE(customer_name, '')) = ''
   OR BTRIM(COALESCE(phone, '')) = '';

ALTER TABLE service_requests
  DROP CONSTRAINT IF EXISTS service_requests_required_text_non_empty,
  ADD CONSTRAINT service_requests_required_text_non_empty
    CHECK (BTRIM(book_title) <> '' AND BTRIM(customer_name) <> '' AND BTRIM(phone) <> '');
