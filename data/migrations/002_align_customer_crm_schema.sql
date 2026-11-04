-- Upgrade the original CRM schema to the canonical shape in customer-schema.sql.
-- Statuses that do not exist in the CRM pipeline are retained as soft-deleted
-- records rather than being removed.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE customers
    ALTER COLUMN address DROP NOT NULL,
    ALTER COLUMN city DROP NOT NULL,
    ALTER COLUMN email TYPE VARCHAR(255),
    ALTER COLUMN source TYPE VARCHAR(50);

ALTER TABLE customers
    DROP CONSTRAINT IF EXISTS customers_status_check,
    DROP CONSTRAINT IF EXISTS customers_email_valid,
    DROP CONSTRAINT IF EXISTS customers_phone_check,
    DROP CONSTRAINT IF EXISTS customers_full_name_check,
    DROP CONSTRAINT IF EXISTS customers_is_active_check,
    DROP CONSTRAINT IF EXISTS customers_source_check,
    DROP CONSTRAINT IF EXISTS customers_email_unique,
    DROP CONSTRAINT IF EXISTS customers_phone_unique;

UPDATE customers
SET status = CASE status
    WHEN 'active' THEN 'customer'
    WHEN 'vip' THEN 'customer'
    WHEN 'inactive' THEN 'new'
    WHEN 'blocked' THEN 'new'
    ELSE status
END,
email = lower(email),
is_active = CASE WHEN status IN ('inactive', 'blocked') THEN FALSE ELSE is_active END,
deleted_at = CASE
    WHEN status IN ('inactive', 'blocked') THEN COALESCE(deleted_at, updated_at, NOW())
    WHEN is_active THEN NULL
    ELSE COALESCE(deleted_at, updated_at, NOW())
END;

ALTER TABLE customers
    ADD CONSTRAINT customers_full_name_check
        CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
    ADD CONSTRAINT customers_phone_check
        CHECK (
            phone ~ '^\+?([0-9]+|\([0-9]+\))([ -]?([0-9]+|\([0-9]+\)))*$' AND
            length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15
        ),
    ADD CONSTRAINT customers_email_valid
        CHECK (
            email = lower(email) AND
            email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
        ),
    ADD CONSTRAINT customers_status_check
        CHECK (status IN ('new', 'lead', 'customer')),
    ADD CONSTRAINT customers_source_check
        CHECK (source IN ('web', 'admin', 'api', 'import')),
    ADD CONSTRAINT customers_is_active_check
        CHECK ((is_active AND deleted_at IS NULL) OR (NOT is_active AND deleted_at IS NOT NULL));

ALTER TABLE customers
    ALTER COLUMN status SET DEFAULT 'new';

DROP INDEX IF EXISTS idx_customers_email;
DROP INDEX IF EXISTS idx_customers_phone;
CREATE UNIQUE INDEX idx_customers_email ON customers (email) WHERE is_active;
CREATE UNIQUE INDEX idx_customers_phone ON customers (phone) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers (updated_at DESC);

ALTER TABLE customer_interactions
    DROP CONSTRAINT IF EXISTS customer_interactions_customer_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_customer_interactions_customer,
    ADD CONSTRAINT fk_customer_interactions_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT;

ALTER TABLE customer_orders
    DROP CONSTRAINT IF EXISTS customer_orders_order_status_check,
    DROP CONSTRAINT IF EXISTS customer_orders_customer_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_customer_orders_customer;

UPDATE customer_orders
SET order_status = 'received'
WHERE order_status IN ('pending', 'confirmed');

ALTER TABLE customer_orders
    ADD CONSTRAINT customer_orders_order_status_check
        CHECK (order_status IN ('received', 'processing', 'shipping', 'completed', 'cancelled')),
    ADD CONSTRAINT fk_customer_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    ALTER COLUMN order_status SET DEFAULT 'received';

CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    purpose VARCHAR(40) NOT NULL
        CHECK (purpose IN ('order', 'service', 'marketing')),
    consent BOOLEAN NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    data_source VARCHAR(20) NOT NULL CHECK (data_source IN ('web', 'admin', 'api')),
    retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT fk_consent_records_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_consent_records_customer_purpose
    ON consent_records (customer_id, purpose, created_at DESC);
