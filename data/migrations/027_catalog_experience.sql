ALTER TABLE booknest_data
  DROP CONSTRAINT IF EXISTS booknest_data_collection_check;

ALTER TABLE booknest_data
  ADD CONSTRAINT booknest_data_collection_check
  CHECK (collection IN (
    'users',
    'customers',
    'orders',
    'services',
    'books',
    'categories',
    'authors',
    'publishers',
    'reviews',
    'favorites',
    'history'
  ));
