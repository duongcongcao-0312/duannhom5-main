# Chuẩn hóa Cấu trúc Database PostgreSQL (`BN-003`)

## 1. Quy ước đặt tên (Naming Conventions)

- **Bảng & cột**: dùng `snake_case` chữ thường (`app_users`, `store_orders`, `store_order_items`, `privacy_data_requests`).
- **Index**: `idx_<tên_bảng>_<cột_hoặc_mục_đích>` (ví dụ `idx_store_orders_user_id_created_at`, `idx_app_users_lower_email`).
- **Khóa ngoại**: `fk_<tên_bảng>_<đối_tượng_tham_chiếu>` (ví dụ `fk_auth_sessions_user`, `fk_store_orders_coupon_code`).
- **Ràng buộc kiểm tra**: `ck_<tên_bảng>_<quy_tắc>` hoặc `<tên_bảng>_<quy_tắc>_check`.
- **Trigger**: `trg_<tên_bảng>_<hành_động>` (ví dụ `trg_store_orders_touch_updated_at`).

## 2. Quy ước kiểu dữ liệu

- **Tiền tệ (VND)**: sử dụng số nguyên `BIGINT` hoặc `NUMERIC(14, 2)` kèm ràng buộc `>= 0` — **tuyệt đối không dùng `FLOAT`/`REAL`/`DOUBLE PRECISION`** để tránh sai số dấu phẩy động.
- **Tỷ lệ giảm giá**: `NUMERIC(4, 3)` kèm `CHECK (rate >= 0 AND rate <= 1)`.
- **Thời gian**: toàn bộ cột thời gian sử dụng `TIMESTAMPTZ` (lưu UTC, có múi giờ), mặc định `NOW()`.
- **Định danh**: `UUID` cho thực thể nghiệp vụ (`order_id`, `customer_id`, `service_id`, `request_id`), `TEXT`/`VARCHAR` cho khóa tự nhiên hoặc tương thích tài khoản cũ (`user_id`, `product_id`, `code`).
- **Dữ liệu bán cấu trúc**: `JSONB` luôn kèm `CHECK (jsonb_typeof(...) = 'object')` khi lưu object.

## 3. Chuẩn hóa Timestamps & Trigger `updated_at`

- Mọi bảng nghiệp vụ chính đều có `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` và `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Migration `025_schema_normalization_timestamps.sql` bổ sung `created_at`/`updated_at` còn thiếu (`book_inventory`, `store_order_items`, `customer_orders`) và gắn trigger `BEFORE UPDATE` dùng hàm `booknest_touch_updated_at()` trên các bảng có thể cập nhật.

## 4. Tương thích nâng cấp & Bảo toàn dữ liệu

- Mọi migration từ `001` đến `025` đều chạy tuần tự, idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`), tương thích với cả **database trống** lẫn **database đang có dữ liệu**, không làm mất bản ghi hợp lệ và không để lại bản ghi mồ côi (được xác minh tự động bởi `backend/migration-integrity.js`).
