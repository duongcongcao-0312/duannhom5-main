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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'privacy_data_requests'
      AND column_name = 'subject_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE privacy_data_requests
      DROP CONSTRAINT IF EXISTS privacy_data_requests_subject_fk;
    ALTER TABLE privacy_data_requests
      ALTER COLUMN subject_id TYPE TEXT USING subject_id::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'privacy_data_requests_subject_fk'
      AND conrelid = 'privacy_data_requests'::regclass
  ) THEN
    ALTER TABLE privacy_data_requests
      ADD CONSTRAINT privacy_data_requests_subject_fk
      FOREIGN KEY (subject_id) REFERENCES app_users(user_id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_data_requests_active_unique
  ON privacy_data_requests (subject_id, request_type)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_privacy_data_requests_subject_created
  ON privacy_data_requests (subject_id, created_at DESC);
