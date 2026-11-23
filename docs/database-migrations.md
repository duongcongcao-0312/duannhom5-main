# Quy trình Migration Cơ sở dữ liệu An toàn (BookNest)

## 1. Quy ước đặt tên, thứ tự & bất biến lịch sử

- Tất cả file migration nằm trong `data/migrations/` theo mẫu `NNN_short_description.sql` (ví dụ `020_privacy_data_request_workflow.sql`).
- `scripts/migrate.js` sắp xếp theo số thứ tự tăng dần (`001`, `002`, ..., `020`), **cấm trùng version** và **cấm file rỗng** (`loadMigrationFiles`).
- Phiên bản đã chạy được lưu trong bảng `schema_migrations (version, filename, checksum, applied_at)` với `checksum` SHA-256:
  - Chạy lại `npm run migrate` là **idempotent** (bỏ qua version đã chạy).
  - **Không sửa file migration đã áp dụng** — nếu phát hiện lệch checksum (`MIGRATION_CHECKSUM_MISMATCH`), quy trình lập tức dừng và yêu cầu tạo file migration mới (forward-fix).
- Quá trình chạy luôn giữ PostgreSQL advisory lock (`pg_advisory_lock`) để tránh 2 instance chạy migration đồng thời.

## 2. Quy trình nâng cấp phiên bản an toàn

1. **Sao lưu trước nâng cấp**: chạy backup PostgreSQL trước khi chạy migration trên staging/production.
2. **Kiểm tra kế hoạch (Dry-run)**: chạy `node scripts/migrate.js --dry-run` để xem danh sách `pending` và đảm bảo `checksumMismatches` rỗng.
3. **Kiểm tra tách biệt môi trường**: `migrate()` tự động gọi `assertDatabaseEnvironmentIsolation(process.env)` để chống chạy nhầm database.
4. **Thực thi giao dịch nguyên tử (per-file transaction)**: mỗi file migration chạy trong một transaction `BEGIN ... COMMIT`; nếu phát sinh lỗi sẽ `ROLLBACK` trọn vẹn phiên bản đó và nhả advisory lock.
5. **Xác minh toàn vẹn sau migration**: ngay sau khi chạy xong, `assertPostMigrationIntegrity(client)` kiểm tra không có migration pending, đủ bảng bắt buộc, không có dữ liệu mồ côi và thỏa các ràng buộc nghiệp vụ.

## 3. Chiến lược xử lý lỗi: Rollback vs Forward-Fix

- **Lỗi trong lúc chạy migration**: PostgreSQL tự `ROLLBACK` toàn bộ file lỗi, giữ nguyên trạng thái trước đó của database.
- **Lỗi sau khi đã triển khai lên database có dữ liệu**:
  - Áp dụng mô hình **Expand-and-Contract (Forward-Fix)**: luôn tạo file migration mới (`NNN+1_fix_...sql`) để bổ sung/điều chỉnh schema mà **không làm mất dữ liệu**.
  - Tránh xóa cột/bảng (`DROP COLUMN`/`DROP TABLE`) trong cùng đợt phát hành với code mới; chỉ dọn dẹp ở phiên bản kế tiếp sau khi xác nhận ổn định.
  - Trường hợp sự cố nghiêm trọng cần hoàn nguyên hoàn toàn, khôi phục từ bản sao lưu trước nâng cấp theo runbook backup.
