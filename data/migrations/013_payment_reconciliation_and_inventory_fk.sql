CREATE TABLE IF NOT EXISTS payment_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_hash TEXT NOT NULL,
    order_id UUID,
    amount BIGINT,
    payment_status VARCHAR(16),
    occurred_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_payment_webhook_events_amount
        CHECK (amount IS NULL OR amount >= 0),
    CONSTRAINT ck_payment_webhook_events_status
        CHECK (
        payment_status IS NULL OR payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')
    ),
    CONSTRAINT fk_payment_webhook_events_order
        FOREIGN KEY (order_id) REFERENCES store_orders(order_id) ON DELETE RESTRICT
);

ALTER TABLE payment_webhook_events
    ADD COLUMN IF NOT EXISTS order_id UUID,
    ADD COLUMN IF NOT EXISTS amount BIGINT,
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16),
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_payment_webhook_events_amount'
          AND conrelid = 'payment_webhook_events'::regclass
    ) THEN
        ALTER TABLE payment_webhook_events
            ADD CONSTRAINT ck_payment_webhook_events_amount
            CHECK (amount IS NULL OR amount >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_payment_webhook_events_status'
          AND conrelid = 'payment_webhook_events'::regclass
    ) THEN
        ALTER TABLE payment_webhook_events
            ADD CONSTRAINT ck_payment_webhook_events_status
            CHECK (
                payment_status IS NULL OR
                payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_payment_webhook_events_order'
          AND conrelid = 'payment_webhook_events'::regclass
    ) THEN
        ALTER TABLE payment_webhook_events
            ADD CONSTRAINT fk_payment_webhook_events_order
            FOREIGN KEY (order_id) REFERENCES store_orders(order_id) ON DELETE RESTRICT;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM book_inventory inventory
        LEFT JOIN store_products product ON product.title = inventory.book_title
        WHERE product.title IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot add inventory product foreign key while orphan inventory rows exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_book_inventory_product'
          AND conrelid = 'book_inventory'::regclass
    ) THEN
        ALTER TABLE book_inventory
            ADD CONSTRAINT fk_book_inventory_product
            FOREIGN KEY (book_title) REFERENCES store_products(title) ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order_received
    ON payment_webhook_events (order_id, received_at DESC)
    WHERE order_id IS NOT NULL;
