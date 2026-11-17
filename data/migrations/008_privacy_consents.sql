CREATE TABLE IF NOT EXISTS privacy_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL,
    purpose VARCHAR(40) NOT NULL
        CHECK (purpose IN ('order', 'service', 'marketing')),
    consent BOOLEAN NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    data_source VARCHAR(20) NOT NULL
        CHECK (data_source IN ('web', 'admin', 'api')),
    retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_subject_purpose
    ON privacy_consents (subject_id, purpose, created_at DESC);
