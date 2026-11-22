ALTER TABLE privacy_data_requests
  DROP CONSTRAINT IF EXISTS privacy_data_requests_request_type_check;

ALTER TABLE privacy_data_requests
  ADD CONSTRAINT privacy_data_requests_request_type_check
    CHECK (request_type IN ('access', 'update', 'export', 'delete'));

ALTER TABLE privacy_data_requests
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_portal'
    CHECK (channel IN ('web_portal', 'email_support', 'in_person')),
  ADD COLUMN IF NOT EXISTS verification_method TEXT NOT NULL DEFAULT 'session_token'
    CHECK (verification_method IN ('session_token', 'password_reauth', 'manual_review')),
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS escalation_level TEXT NOT NULL DEFAULT 'l1_support'
    CHECK (escalation_level IN ('l1_support', 'l2_privacy_lead', 'l3_legal_admin')),
  ADD COLUMN IF NOT EXISTS resolution_code TEXT
    CHECK (
      resolution_code IS NULL OR resolution_code IN (
        'fulfilled',
        'partially_fulfilled',
        'anonymized',
        'rejected_unverified',
        'rejected_legal_retention',
        'rejected_duplicate',
        'withdrawn'
      )
    ),
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_privacy_data_requests_status_due
  ON privacy_data_requests (status, due_at ASC);
