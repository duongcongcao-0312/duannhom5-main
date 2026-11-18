ALTER TABLE store_orders
  ADD COLUMN access_code_hash TEXT
  CHECK (access_code_hash IS NULL OR access_code_hash ~ '^[a-f0-9]{64}$');

UPDATE store_orders
SET access_code_hash = legacy_record->>'accessCodeHash'
WHERE access_code_hash IS NULL
  AND legacy_record ? 'accessCodeHash'
  AND legacy_record->>'accessCodeHash' ~ '^[a-f0-9]{64}$';
