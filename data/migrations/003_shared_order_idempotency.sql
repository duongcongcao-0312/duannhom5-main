CREATE TABLE IF NOT EXISTS booknest_data (
    collection TEXT PRIMARY KEY CHECK (collection IN ('users', 'customers', 'orders', 'services', 'books')),
    records JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_idempotency (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    request_hash CHAR(64) CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$'),
    order_record JSONB NOT NULL CHECK (jsonb_typeof(order_record) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO order_idempotency (idempotency_key, request_hash, order_record)
SELECT
    legacy_order.order_record->>'idempotencyKey',
    legacy_order.order_record->>'idempotencyHash',
    legacy_order.order_record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS legacy_order(order_record)
WHERE collection = 'orders'
  AND NULLIF(legacy_order.order_record->>'idempotencyKey', '') IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;
