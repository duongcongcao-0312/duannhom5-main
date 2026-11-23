# Danh mục Khóa chính (PK) & Khóa ngoại (FK) toàn Schema PostgreSQL (`BN-004`)

| Bảng | Khóa chính (PK) | Khóa ngoại (FK) & Chính sách `ON DELETE` |
| --- | --- | --- |
| `app_users` | `user_id` (`TEXT`) | — |
| `auth_sessions` | `session_hash` (`TEXT`) | `user_id -> app_users(user_id) ON DELETE CASCADE` (`fk_auth_sessions_user`) |
| `store_products` | `product_id` (`TEXT`) | — |
| `book_inventory` | `book_title` (`VARCHAR(200)`) | `book_title -> store_products(title) ON DELETE CASCADE` (`fk_book_inventory_product`) |
| `coupon_promotions` | `code` (`VARCHAR(32)`) | — |
| `store_orders` | `order_id` (`UUID`) | `user_id -> app_users(user_id) ON DELETE SET NULL`; `coupon_code -> coupon_promotions(code) ON DELETE SET NULL` (`fk_store_orders_coupon_code`) |
| `store_order_items` | `(order_id, product_title)` | `order_id -> store_orders(order_id) ON DELETE CASCADE`; `product_title -> store_products(title) ON DELETE RESTRICT` |
| `payment_webhook_events` | `event_id` (`TEXT`) | `order_id -> store_orders(order_id) ON DELETE RESTRICT` (`fk_payment_webhook_events_order`) |
| `order_idempotency` | `idempotency_key` (`VARCHAR(128)`) | — |
| `service_requests` | `service_id` (`UUID`) | — |
| `customers` | `customer_id` (`UUID`) | — |
| `customer_interactions` | `id` (`UUID`) | `customer_id -> customers(customer_id) ON DELETE RESTRICT` |
| `customer_orders` | `customer_order_id` (`UUID`) | `customer_id -> customers(customer_id) ON DELETE RESTRICT`; `order_id -> store_orders(order_id) ON DELETE RESTRICT` (`fk_customer_orders_store_order`) |
| `consent_records` | `id` (`UUID`) | `customer_id -> customers(customer_id) ON DELETE RESTRICT` |
| `privacy_consents` | `id` (`UUID`) | `subject_id` (`UUID`, hỗ trợ cả chủ thể khách hàng & người dùng nên chủ đích không khóa cứng vào một bảng duy nhất) |
| `privacy_data_requests` | `request_id` (`UUID`) | `subject_id -> app_users(user_id) ON DELETE RESTRICT` |
| `shared_rate_limits` | `bucket_key` (`TEXT`) | — |
| `booknest_data` | `collection` (`TEXT`) | — |
| `schema_migrations` | `version` (`TEXT`) | — |

## Kiểm tra dữ liệu mồ côi sau migration

Sau mỗi lần chạy `npm run migrate`, `backend/migration-integrity.js` tự động chạy các truy vấn phát hiện bản ghi mồ côi (`orphaned_order_items`, `orphaned_customer_interactions`, `orphaned_order_users`) và dừng báo lỗi nếu có bất kỳ sai lệch nào.
