CREATE TABLE IF NOT EXISTS coupon_promotions (
    code VARCHAR(32) PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
    label VARCHAR(120) NOT NULL,
    rate NUMERIC(5, 4) NOT NULL CHECK (rate >= 0.01 AND rate <= 0.30),
    min_subtotal BIGINT NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at),
    CHECK (max_uses IS NULL OR used_count <= max_uses)
);

INSERT INTO coupon_promotions (code, label, rate)
VALUES
    ('BOOKNEST10', 'Ưu đãi BookNest', 0.10),
    ('WELCOME5', 'Ưu đãi chào mừng', 0.05)
ON CONFLICT (code) DO NOTHING;
