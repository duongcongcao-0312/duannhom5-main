CREATE TABLE IF NOT EXISTS privacy_data_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'update', 'delete')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  created_by TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT privacy_data_requests_subject_fk
    FOREIGN KEY (subject_id) REFERENCES app_users(user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_data_requests_active_unique
  ON privacy_data_requests (subject_id, request_type)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_privacy_data_requests_subject_created
  ON privacy_data_requests (subject_id, created_at DESC);
