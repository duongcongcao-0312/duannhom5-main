-- BN-128: idx_store_orders_payment_status_created has the same leading key
-- and also supports chronological ordering, so the single-column index is redundant.
-- Keep this guarded for installations where migration 022 has not provisioned the replacement.
DO $$
BEGIN
    IF to_regclass('idx_store_orders_payment_status_created') IS NOT NULL THEN
        DROP INDEX IF EXISTS idx_store_orders_payment_status;
    END IF;
END
$$;
