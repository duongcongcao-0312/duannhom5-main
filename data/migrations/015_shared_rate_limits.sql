CREATE TABLE IF NOT EXISTS shared_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_rate_limits_expires_at
  ON shared_rate_limits (expires_at);
