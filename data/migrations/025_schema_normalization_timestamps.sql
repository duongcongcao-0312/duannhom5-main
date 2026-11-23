-- BN-003: Standardize UTC TIMESTAMPTZ audit columns and automatic updated_at triggers
-- across core mutable PostgreSQL tables (compatible with empty and populated databases).

ALTER TABLE book_inventory
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE store_order_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION booknest_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target_table TEXT;
  trigger_name TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'app_users',
    'store_products',
    'store_orders',
    'service_requests',
    'customers',
    'coupon_promotions',
    'privacy_data_requests'
  ] LOOP
    trigger_name := 'trg_' || target_table || '_touch_updated_at';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, target_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION booknest_touch_updated_at()',
      trigger_name,
      target_table
    );
  END LOOP;
END
$$;
