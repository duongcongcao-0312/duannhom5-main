-- Initial PostgreSQL migration for the BookNest CRM target schema.
-- Requires PostgreSQL 13+ (gen_random_uuid is built in).
-- Apply with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data/customer-schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS customers (
    customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(120) NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
    gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    dob DATE,
    phone VARCHAR(20) NOT NULL CHECK (phone ~ '^\+?[0-9]{8,15}$'),
    email VARCHAR(254) NOT NULL CHECK (
        email = lower(email) AND
        email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) NOT NULL DEFAULT 'Vietnam',
    source VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'admin', 'api', 'import')),
    status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'lead', 'customer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    CHECK ((is_active AND deleted_at IS NULL) OR (NOT is_active AND deleted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
    ON customers (email) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone
    ON customers (phone) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers (city);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers (updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('call', 'chat', 'email', 'order', 'review', 'support', 'feedback')),
    note TEXT NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_customer_interactions_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id
    ON customer_interactions (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_orders (
    customer_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    order_id UUID NOT NULL,
    order_no VARCHAR(50) NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
    order_status VARCHAR(30) NOT NULL DEFAULT 'received'
        CHECK (order_status IN ('received', 'processing', 'shipping', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_orders_order_unique UNIQUE (order_id),
    CONSTRAINT customer_orders_order_no_unique UNIQUE (order_no),
    CONSTRAINT fk_customer_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id
    ON customer_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_status
    ON customer_orders (order_status);

CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    purpose VARCHAR(40) NOT NULL CHECK (purpose IN ('order', 'service', 'marketing')),
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

COMMIT;
