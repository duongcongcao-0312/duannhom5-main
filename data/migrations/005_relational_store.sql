CREATE TABLE IF NOT EXISTS booknest_data (
    collection TEXT PRIMARY KEY CHECK (collection IN ('users', 'customers', 'orders', 'services', 'books')),
    records JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
    user_id TEXT PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'admin', 'sales', 'support')),
    student_type VARCHAR(32) NOT NULL DEFAULT 'other',
    student_id VARCHAR(64) NOT NULL DEFAULT '',
    auth_provider VARCHAR(32),
    provider_id VARCHAR(255),
    customer_info JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(customer_info) = 'object'),
    password_reset JSONB CHECK (password_reset IS NULL OR jsonb_typeof(password_reset) = 'object'),
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    updated_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    legacy_record JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(legacy_record) = 'object'),
    CONSTRAINT app_users_email_valid CHECK (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_provider
    ON app_users (auth_provider, provider_id)
    WHERE auth_provider IS NOT NULL AND provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users (role);

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS legacy_record JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(legacy_record) = 'object');

CREATE TABLE IF NOT EXISTS store_products (
    product_id TEXT PRIMARY KEY,
    title VARCHAR(200) NOT NULL UNIQUE,
    author VARCHAR(200) NOT NULL DEFAULT '',
    category VARCHAR(64) NOT NULL DEFAULT 'van-hoc',
    price BIGINT NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0),
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    cover TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    legacy_record JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(legacy_record) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_store_products_category ON store_products (category);

CREATE TABLE IF NOT EXISTS store_orders (
    order_id UUID PRIMARY KEY,
    user_id TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
    customer_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address VARCHAR(300) NOT NULL,
    payment_method VARCHAR(16) NOT NULL CHECK (payment_method IN ('transfer', 'cod')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('received', 'processing', 'shipping', 'completed', 'cancelled')),
    payment_status VARCHAR(16) NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'cod_pending', 'refunded')),
    coupon_code VARCHAR(64),
    discount_rate NUMERIC(4, 3) NOT NULL DEFAULT 0 CHECK (discount_rate >= 0 AND discount_rate <= 1),
    subtotal BIGINT NOT NULL CHECK (subtotal >= 0),
    discount BIGINT NOT NULL CHECK (discount >= 0 AND discount <= subtotal),
    total BIGINT NOT NULL CHECK (total = subtotal - discount),
    idempotency_key VARCHAR(128) UNIQUE,
    idempotency_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    legacy_record JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(legacy_record) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_store_orders_user_id_created_at
    ON store_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_status_created_at
    ON store_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_payment_status
    ON store_orders (payment_status);

CREATE TABLE IF NOT EXISTS store_order_items (
    order_id UUID NOT NULL REFERENCES store_orders(order_id) ON DELETE CASCADE,
    product_title VARCHAR(200) NOT NULL REFERENCES store_products(title) ON DELETE RESTRICT,
    author VARCHAR(200) NOT NULL DEFAULT '',
    unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total BIGINT NOT NULL CHECK (line_total = unit_price * quantity),
    PRIMARY KEY (order_id, product_title)
);

CREATE INDEX IF NOT EXISTS idx_store_order_items_product_title
    ON store_order_items (product_title);

CREATE TABLE IF NOT EXISTS service_requests (
    service_id UUID PRIMARY KEY,
    service_type VARCHAR(16) NOT NULL CHECK (service_type IN ('rent', 'sell', 'exchange')),
    book_title VARCHAR(200) NOT NULL,
    condition VARCHAR(64) NOT NULL DEFAULT '',
    customer_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    note VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    legacy_record JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(legacy_record) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_service_requests_status_created_at
    ON service_requests (status, created_at DESC);

INSERT INTO app_users (
    user_id, email, full_name, password_hash, role, student_type, student_id,
    auth_provider, provider_id, customer_info, password_reset, created_by, updated_by,
    created_at, updated_at, legacy_record
)
SELECT
    record->>'id',
    lower(record->>'email'),
    COALESCE(NULLIF(record->>'name', ''), 'BookNest user'),
    COALESCE(record->>'password', ''),
    CASE WHEN record->>'role' IN ('user', 'admin', 'sales', 'support') THEN record->>'role' ELSE 'user' END,
    COALESCE(NULLIF(record->>'studentType', ''), 'other'),
    COALESCE(record->>'studentId', ''),
    NULLIF(record->>'authProvider', ''),
    NULLIF(record->>'providerId', ''),
    CASE WHEN jsonb_typeof(record->'customerInfo') = 'object' THEN record->'customerInfo' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(record->'passwordReset') = 'object' THEN record->'passwordReset' ELSE NULL END,
    COALESCE(NULLIF(record->>'createdBy', ''), 'system'),
    COALESCE(NULLIF(record->>'updatedBy', ''), 'system'),
    COALESCE((record->>'createdAt')::timestamptz, NOW()),
    COALESCE((record->>'updatedAt')::timestamptz, NOW()),
    record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'users' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS source(record)
WHERE collection = 'users'
ON CONFLICT DO NOTHING;

INSERT INTO customers (
    customer_id, full_name, phone, email, address, city, status, source,
    created_by, updated_by, created_at, updated_at, is_active, deleted_at, legacy_record
)
SELECT
    CASE WHEN record->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (record->>'id')::uuid ELSE gen_random_uuid() END,
    CASE WHEN length(trim(record->>'name')) BETWEEN 2 AND 120
      THEN trim(record->>'name') ELSE 'Legacy customer' END,
    CASE
      WHEN regexp_replace(COALESCE(record->>'phone', ''), '[^0-9]', '', 'g') ~ '^[0-9]{8,15}$'
        AND record->>'phone' ~ '^\+?([0-9]+|\([0-9]+\))([ -]?([0-9]+|\([0-9]+\)))*$'
      THEN record->>'phone'
      ELSE '+840' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)
    END,
    CASE WHEN lower(record->>'email') ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
      THEN lower(record->>'email')
      ELSE 'legacy-' || gen_random_uuid() || '@example.invalid' END,
    NULLIF(record->>'address', ''),
    NULLIF(record->>'city', ''),
    CASE WHEN record->>'status' IN ('new', 'lead', 'customer') THEN record->>'status' ELSE 'new' END,
    CASE WHEN record->>'source' IN ('web', 'admin', 'api', 'import') THEN record->>'source' ELSE 'import' END,
    COALESCE(NULLIF(record->>'created_by', ''), NULLIF(record->>'createdBy', ''), 'migration'),
    COALESCE(NULLIF(record->>'updated_by', ''), NULLIF(record->>'updatedBy', ''), 'migration'),
    COALESCE((record->>'createdAt')::timestamptz, NOW()),
    COALESCE((record->>'updatedAt')::timestamptz, (record->>'createdAt')::timestamptz, NOW()),
    NULLIF(record->>'deletedAt', '') IS NULL,
    NULLIF(record->>'deletedAt', '')::timestamptz,
    record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'customers' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS source(record)
WHERE collection = 'customers'
  AND NOT EXISTS (
    SELECT 1 FROM customers existing
    WHERE existing.customer_id = CASE
      WHEN record->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (record->>'id')::uuid ELSE NULL END
      OR (existing.is_active AND (
        existing.email = CASE
          WHEN lower(record->>'email') ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
            THEN lower(record->>'email') ELSE NULL END
        OR existing.phone = CASE
          WHEN regexp_replace(COALESCE(record->>'phone', ''), '[^0-9]', '', 'g') ~ '^[0-9]{8,15}$'
            AND record->>'phone' ~ '^\+?([0-9]+|\([0-9]+\))([ -]?([0-9]+|\([0-9]+\)))*$'
            THEN record->>'phone' ELSE NULL END
      ))
  )
ON CONFLICT DO NOTHING;

INSERT INTO store_products (
    product_id, title, author, category, price, stock, is_custom, cover, description,
    created_at, updated_at, legacy_record
)
SELECT
    COALESCE(NULLIF(record->>'id', ''), record->>'title'),
    record->>'title',
    COALESCE(record->>'author', ''),
    COALESCE(NULLIF(record->>'category', ''), 'van-hoc'),
    GREATEST(COALESCE(NULLIF(record->>'price', '')::numeric, 0), 0)::bigint,
    GREATEST(COALESCE(NULLIF(record->>'stock', '')::integer, 12), 0),
    TRUE,
    COALESCE(record->>'cover', ''),
    COALESCE(record->>'description', ''),
    COALESCE((record->>'createdAt')::timestamptz, NOW()),
    COALESCE((record->>'updatedAt')::timestamptz, (record->>'createdAt')::timestamptz, NOW()),
    record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'books' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS source(record)
WHERE collection = 'books'
ON CONFLICT DO NOTHING;

INSERT INTO store_products (product_id, title, author, price, stock, is_custom, legacy_record)
SELECT
    'inventory-' || inventory.book_title,
    inventory.book_title,
    '',
    0,
    inventory.stock,
    FALSE,
    '{}'::jsonb
FROM book_inventory inventory
ON CONFLICT DO NOTHING;

INSERT INTO store_products (product_id, title, author, price, stock, is_custom, legacy_record)
SELECT
    'legacy-' || (item->>'title'),
    item->>'title',
    COALESCE(item->>'author', ''),
    GREATEST(COALESCE(NULLIF(item->>'unitPrice', '')::numeric, 0), 0)::bigint,
    COALESCE(inventory.stock, 12),
    FALSE,
    '{}'::jsonb
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'orders' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS order_source(record)
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(record->'items') = 'array' THEN record->'items' ELSE '[]'::jsonb END
) AS item
LEFT JOIN book_inventory inventory ON inventory.book_title = item->>'title'
WHERE collection = 'orders'
  AND NULLIF(item->>'title', '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO store_orders (
    order_id, user_id, customer_name, phone, address, payment_method, status, payment_status,
    coupon_code, discount_rate, subtotal, discount, total, idempotency_key, idempotency_hash,
    created_at, updated_at, legacy_record
)
SELECT
    (record->>'orderId')::uuid,
    CASE WHEN EXISTS (SELECT 1 FROM app_users WHERE user_id = record->>'userId') THEN record->>'userId' ELSE NULL END,
    COALESCE(NULLIF(record->>'customerName', ''), 'Legacy customer'),
    COALESCE(NULLIF(record->>'phone', ''), ''),
    COALESCE(NULLIF(record->>'address', ''), ''),
    CASE WHEN record->>'paymentMethod' IN ('cod', 'transfer') THEN record->>'paymentMethod' ELSE 'cod' END,
    CASE WHEN record->>'status' IN ('received', 'processing', 'shipping', 'completed', 'cancelled') THEN record->>'status' ELSE 'received' END,
    CASE WHEN record->>'paymentStatus' IN ('pending', 'paid', 'failed', 'cancelled', 'cod_pending', 'refunded') THEN record->>'paymentStatus' ELSE 'cod_pending' END,
    NULLIF(record->>'couponCode', ''),
    COALESCE(NULLIF(record->>'discountRate', '')::numeric, 0),
    GREATEST(COALESCE(NULLIF(record->>'subtotal', '')::numeric, 0), 0)::bigint,
    GREATEST(COALESCE(NULLIF(record->>'discount', '')::numeric, 0), 0)::bigint,
    GREATEST(COALESCE(NULLIF(record->>'total', '')::numeric, 0), 0)::bigint,
    NULLIF(record->>'idempotencyKey', ''),
    NULLIF(record->>'idempotencyHash', ''),
    COALESCE((record->>'createdAt')::timestamptz, NOW()),
    COALESCE((record->>'updatedAt')::timestamptz, (record->>'createdAt')::timestamptz, NOW()),
    record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'orders' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS source(record)
WHERE collection = 'orders'
ON CONFLICT DO NOTHING;

INSERT INTO store_order_items (order_id, product_title, author, unit_price, quantity, line_total)
SELECT
    order_record.order_id,
    item->>'title',
    COALESCE(item->>'author', ''),
    GREATEST(COALESCE(NULLIF(item->>'unitPrice', '')::numeric, 0), 0)::bigint,
    GREATEST(COALESCE(NULLIF(item->>'quantity', '')::integer, 1), 1),
    GREATEST(COALESCE(NULLIF(item->>'lineTotal', '')::numeric,
      NULLIF(item->>'unitPrice', '')::numeric * NULLIF(item->>'quantity', '')::numeric, 0), 0)::bigint
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'orders' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS order_source(record)
JOIN store_orders order_record ON order_record.order_id = (order_source.record->>'orderId')::uuid
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(order_source.record->'items') = 'array' THEN order_source.record->'items' ELSE '[]'::jsonb END
) AS item
WHERE collection = 'orders'
ON CONFLICT DO NOTHING;

INSERT INTO service_requests (
    service_id, service_type, book_title, condition, customer_name, phone, note, status,
    created_at, updated_at, legacy_record
)
SELECT
    CASE WHEN record->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (record->>'id')::uuid ELSE gen_random_uuid() END,
    CASE WHEN record->>'service' IN ('rent', 'sell', 'exchange') THEN record->>'service' ELSE 'rent' END,
    COALESCE(NULLIF(record->>'bookTitle', ''), 'Unknown book'),
    COALESCE(record->>'condition', ''),
    COALESCE(NULLIF(record->>'name', ''), 'Legacy customer'),
    COALESCE(record->>'phone', ''),
    COALESCE(record->>'note', ''),
    CASE WHEN record->>'status' IN ('pending', 'processing', 'completed', 'cancelled') THEN record->>'status' ELSE 'pending' END,
    COALESCE((record->>'createdAt')::timestamptz, NOW()),
    COALESCE((record->>'updatedAt')::timestamptz, (record->>'createdAt')::timestamptz, NOW()),
    record
FROM booknest_data
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN collection = 'services' AND jsonb_typeof(records) = 'array' THEN records ELSE '[]'::jsonb END
) AS source(record)
WHERE collection = 'services'
ON CONFLICT DO NOTHING;

ALTER TABLE book_inventory
    ADD CONSTRAINT fk_book_inventory_product
    FOREIGN KEY (book_title) REFERENCES store_products(title) ON DELETE RESTRICT;
