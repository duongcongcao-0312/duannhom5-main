-- BN-004: Harden remaining foreign keys across auth_sessions, store_orders, and customer_orders.
-- Safely handles legacy/orphan references before adding constraints without losing business records.

CREATE TABLE IF NOT EXISTS auth_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Remove expired/orphaned auth_sessions whose user_id no longer exists in app_users
DELETE FROM auth_sessions s
WHERE NOT EXISTS (
    SELECT 1 FROM app_users u WHERE u.user_id = s.user_id
);

-- 2. Detach legacy store_orders.coupon_code values not present in coupon_promotions (order data preserved)
UPDATE store_orders o
SET coupon_code = NULL
WHERE o.coupon_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM coupon_promotions c WHERE c.code = o.coupon_code
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_auth_sessions_user'
          AND conrelid = 'auth_sessions'::regclass
    ) THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT fk_auth_sessions_user
            FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_store_orders_coupon_code'
          AND conrelid = 'store_orders'::regclass
    ) THEN
        ALTER TABLE store_orders
            ADD CONSTRAINT fk_store_orders_coupon_code
            FOREIGN KEY (coupon_code) REFERENCES coupon_promotions(code) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM customer_orders co
        LEFT JOIN store_orders so ON so.order_id = co.order_id
        WHERE so.order_id IS NULL
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_customer_orders_store_order'
          AND conrelid = 'customer_orders'::regclass
    ) THEN
        ALTER TABLE customer_orders
            ADD CONSTRAINT fk_customer_orders_store_order
            FOREIGN KEY (order_id) REFERENCES store_orders(order_id) ON DELETE RESTRICT;
    END IF;
END
$$;
