ALTER TABLE customer_interactions
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE customer_interactions
SET updated_by = COALESCE(updated_by, created_by),
    updated_at = COALESCE(updated_at, created_at);

ALTER TABLE customer_interactions
    ALTER COLUMN updated_by SET NOT NULL,
    ALTER COLUMN updated_by SET DEFAULT 'system',
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT NOW();
