-- BN-006: Targeted indexes for frequent lookup, filter, join, and sort queries.
-- Uses partial indexes where applicable to minimize write overhead and storage footprint.

-- 1. Case-insensitive login & account lookup (WHERE lower(email) = $1 LIMIT 1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_lower_email
  ON app_users (lower(email));

-- 2. Custom catalog books listing (WHERE is_custom = TRUE ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_store_products_custom_created
  ON store_products (created_at)
  WHERE is_custom = TRUE;

-- 3. Order chronological listing & admin order dashboard (ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_store_orders_created_at
  ON store_orders (created_at DESC);

-- 4. Order payment status filtering with chronological ordering
CREATE INDEX IF NOT EXISTS idx_store_orders_payment_status_created
  ON store_orders (payment_status, created_at DESC);

-- 5. Active CRM customer listing by status and creation time
CREATE INDEX IF NOT EXISTS idx_customers_active_status_created
  ON customers (status, created_at DESC)
  WHERE is_active = TRUE;

-- 6. Scheduled privacy consent retention pruning (WHERE retain_until <= $1)
ALTER TABLE privacy_consents
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ;

UPDATE privacy_consents
SET retain_until = created_at + retention_days * INTERVAL '1 day'
WHERE retain_until IS NULL;

CREATE OR REPLACE FUNCTION booknest_set_consent_retain_until()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
     NEW.retention_days IS DISTINCT FROM OLD.retention_days OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    NEW.retain_until := NEW.created_at + NEW.retention_days * INTERVAL '1 day';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_privacy_consents_retain_until ON privacy_consents;
CREATE TRIGGER trg_privacy_consents_retain_until
  BEFORE INSERT OR UPDATE OF retention_days, created_at
  ON privacy_consents
  FOR EACH ROW
  EXECUTE FUNCTION booknest_set_consent_retain_until();

ALTER TABLE privacy_consents
  ALTER COLUMN retain_until SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_privacy_consents_retain_until
  ON privacy_consents (retain_until);
