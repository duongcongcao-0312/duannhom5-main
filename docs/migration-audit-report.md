# Báo cáo rà soát toàn bộ migration PostgreSQL (BN-002 / Issue #141)

Tài liệu này ghi nhận kết quả rà soát cú pháp, thứ tự phụ thuộc, tính lặp an toàn (idempotency), xung đột schema và bước chuyển đổi dữ liệu cho toàn bộ 16 file migration nền tảng (`001`–`016`), đồng thời đối chiếu tính liên tục với các migration mở rộng (`017`–`025`).

## 1. Bảng rà soát 16 file migration nền tảng (`001`–`016`)

| Version | File | Phụ thuộc bảng | Chuyển đổi dữ liệu | Trạng thái sau rà soát |
| --- | --- | --- | --- | --- |
| `001` | `001_customer_crm.sql` | Khởi tạo `customers`, `customer_interactions`, `customer_orders` | Không | Đạt (`CREATE EXTENSION/TABLE/INDEX IF NOT EXISTS`) |
| `002` | `002_align_customer_crm_schema.sql` | `001` (`customers`, `customer_interactions`, `customer_orders`) | Chuẩn hóa `status` (`active`/`vip` → `customer`, `inactive`/`blocked` → `new` + soft-delete), `order_status` (`pending`/`confirmed` → `received`) | Đạt (idempotent, bảo toàn dữ liệu) |
| `003` | `003_shared_order_idempotency.sql` | Khởi tạo `booknest_data`, `order_idempotency` | Backfill `order_idempotency` từ `booknest_data` với `ON CONFLICT DO NOTHING` | Đạt |
| `004` | `004_transactional_book_inventory.sql` | Khởi tạo `book_inventory` | Không | Đạt |
| `005` | `005_relational_store.sql` | `001`, `003`, `004` | Di chuyển dữ liệu JSONB (`users`, `customers`, `books`, `orders`, `services`) sang các bảng quan hệ với `ON CONFLICT DO NOTHING` | **Đã sửa**: bọc `fk_book_inventory_product` trong `DO $$ IF NOT EXISTS` và thống nhất `ON DELETE CASCADE` với `013` |
| `006` | `006_coupon_promotions.sql` | Khởi tạo `coupon_promotions` | Seed `BOOKNEST10`, `WELCOME5` với `ON CONFLICT DO NOTHING` | Đạt |
| `007` | `007_customer_interaction_audit.sql` | `001` (`customer_interactions`) | Backfill `updated_by`, `updated_at` từ `created_by`, `created_at` trước khi đặt `NOT NULL` | Đạt |
| `008` | `008_privacy_consents.sql` | Khởi tạo `privacy_consents` | Không | Đạt |
| `009` | `009_payment_reconciliation.sql` | Placeholder lịch sử (0 byte, đã gộp vào `013`) | Không | Đạt (`scripts/migrate.js` xử lý `isNoop: true`) |
| `010` | `010_inventory_product_fk.sql` | Placeholder lịch sử (0 byte, đã gộp vào `013`) | Không | Đạt (`isNoop: true`) |
| `011` | `011_privacy_data_requests.sql` | Placeholder lịch sử (0 byte, đã chuyển sang `014`) | Không | Đạt (`isNoop: true`) |
| `012` | `012_service_request_subject.sql` | Placeholder lịch sử (0 byte) | Không | Đạt (`isNoop: true`) |
| `013` | `013_payment_reconciliation_and_inventory_fk.sql` | `004`, `005` (`store_orders`, `store_products`, `book_inventory`) | Kiểm tra bản ghi mồ côi `book_inventory` trước khi gắn FK | Đạt (idempotent `DO $$` + `IF NOT EXISTS`) |
| `014` | `014_privacy_data_requests.sql` | `005` (`app_users`) | Không | **Đã sửa lỗi nghiêm trọng**: `subject_id` từ `UUID` sang `TEXT` khớp `app_users(user_id TEXT)` |
| `015` | `015_shared_rate_limits.sql` | Khởi tạo `shared_rate_limits` | Không | **Đã sửa**: bổ sung `IF NOT EXISTS` cho bảng và index |
| `016` | `016_guest_order_access_codes.sql` | `005` (`store_orders`) | Backfill `access_code_hash` từ `legacy_record->>'accessCodeHash'` | **Đã sửa**: bổ sung `ADD COLUMN IF NOT EXISTS` |

## 2. Các lỗi và xung đột đã phát hiện & khắc phục

1. **Lỗi không tương thích kiểu khóa ngoại ở `014_privacy_data_requests.sql` (Nghiêm trọng — chặn chạy trên DB trống)**:
   - `app_users.user_id` trong `005_relational_store.sql` có kiểu `TEXT PRIMARY KEY`, nhưng `014_privacy_data_requests.sql` khai báo `subject_id UUID NOT NULL` và gắn `FOREIGN KEY (subject_id) REFERENCES app_users(user_id)`. PostgreSQL từ chối tạo khóa ngoại giữa `uuid` và `text`.
   - **Khắc phục**: Đổi `subject_id` thành `TEXT NOT NULL` trong `014_privacy_data_requests.sql` và bổ sung test hồi quy kiểm tra sự tương thích kiểu dữ liệu FK với `app_users(user_id)`.
2. **Xung đột hành vi xóa và thiếu guard idempotent của `fk_book_inventory_product` giữa `005` và `013`**:
   - `005_relational_store.sql` chạy `ALTER TABLE book_inventory ADD CONSTRAINT fk_book_inventory_product ... ON DELETE RESTRICT` không có điều kiện kiểm tra tồn tại, trong khi `013_payment_reconciliation_and_inventory_fk.sql` và `tests/postgres-migrations.test.js` kỳ vọng `ON DELETE CASCADE`.
   - **Khắc phục**: Bọc câu lệnh trong khối `DO $$ IF NOT EXISTS (...)` và thống nhất `ON DELETE CASCADE` trong `005_relational_store.sql`.
3. **Thiếu `IF NOT EXISTS` ở `015_shared_rate_limits.sql` và `016_guest_order_access_codes.sql`**:
   - Nếu chạy lại câu lệnh DDL trên môi trường đã có bảng/cột (ví dụ phục hồi thủ công), câu lệnh sẽ báo lỗi tồn tại.
   - **Khắc phục**: Bổ sung `IF NOT EXISTS` cho `CREATE TABLE`, `CREATE INDEX` (`015`) và `ADD COLUMN` (`016`).
4. **Placeholder 0 byte `009`–`012`**:
   - Giữ nguyên để bảo toàn thứ tự phiên bản lịch sử (`schema_migrations`), đồng thời `scripts/migrate.js` xử lý `isNoop: true` an toàn không gây lỗi.
5. **Danh sách version hard-code trong `tests/postgres-migrations.test.js`**:
   - Đã cập nhật từ hard-code `16` phiên bản sang đối chiếu động với `loadMigrationFiles(migrationsDirectory)` để tương thích toàn bộ chuỗi migration (`001`–`025`).

## 3. Kiểm thử hồi quy

- `tests/migration-audit-regression.test.js`: Kiểm tra tự động toàn bộ chuỗi migration về thứ tự phiên bản liên tục, cân bằng ngoặc/`DO $$`, tương thích kiểu FK `app_users(user_id)`, tính idempotent của DDL, thứ tự phụ thuộc bảng (`CREATE TABLE` trước `ALTER TABLE`/`REFERENCES`), và mô phỏng chạy đầy đủ + chạy lặp lại qua `runMigrations`.
- `tests/migrations.test.js` & `tests/safe-migration-workflow.test.js`: Xác minh thứ tự chạy, rollback khi lỗi, xử lý no-op và kiểm tra checksum.
