CREATE TABLE IF NOT EXISTS book_inventory (
    book_title VARCHAR(200) PRIMARY KEY,
    stock INTEGER NOT NULL CHECK (stock >= 0),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= stock),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
