CREATE TABLE IF NOT EXISTS booknest_data (
  collection TEXT PRIMARY KEY CHECK (collection IN ('users', 'customers', 'orders', 'services', 'books')),
  records JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
