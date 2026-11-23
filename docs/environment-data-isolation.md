# Tách biệt dữ liệu & cấu hình môi trường (Development, Staging, Production)

## 1. Quy ước tách biệt môi trường

| Môi trường | `APP_ENV` | `NODE_ENV` | Database khuyến nghị | Tài khoản DB & Quyền | Dữ liệu |
| --- | --- | --- | --- | --- | --- |
| Development | `development` | `development` | File cục bộ hoặc `booknest_dev` (`localhost`) | User riêng `booknest_dev_app` | Dữ liệu giả lập / seed (`npm run seed:customers`) |
| Test / CI | `test` | `test` | Thư mục tạm hoặc `booknest_test` | User riêng `booknest_test_app` | Dữ liệu tổng hợp (synthetic fixtures) |
| Staging | `staging` | `production` | `booknest_staging` (host riêng) | User riêng `booknest_staging_app` | Dữ liệu kiểm thử hoặc đã ẩn danh hoàn toàn |
| Production | `production` | `production` | `booknest_prod` (host managed SSL) | User riêng `booknest_prod_app` (least privilege) | Dữ liệu thật — **cấm seed dữ liệu mẫu** |

## 2. Cơ chế kiểm tra tự động chống ghi nhầm Production (`backend/env-isolation.js`)

Hệ thống tự động thực thi `validateDatabaseEnvironmentIsolation` / `assertDatabaseEnvironmentIsolation` ở cả **khởi động server (`server.js`)**, **kiểm tra trước triển khai (`scripts/predeploy-check.js`)**, và **script seed (`scripts/seed-customers.js`)**:

- **Chặn dev/test/staging kết nối tới production**: từ chối bất kỳ `DATABASE_URL` nào có tên database hoặc hostname chứa dấu hiệu `prod` / `production`.
- **Chặn production kết nối tới dev/staging/test/localhost**: từ chối `DATABASE_URL` trỏ về `localhost`/`127.0.0.1` hoặc tên database chứa `dev`/`staging`/`stage`/`test`/`local`.
- **Khóa cứng tên database mục tiêu**: hỗ trợ biến `EXPECTED_DATABASE_NAME` để xác nhận tuyệt đối tên database trong `DATABASE_URL` khớp môi trường triển khai.
- **Chặn seed trên production**: `assertSeedAllowed` luôn chặn `scripts/seed-customers.js` khi `APP_ENV`/`NODE_ENV` là `production` hoặc `DATABASE_URL` trỏ tới host/database production.

## 3. Quy trình thiết lập, seed & nguyên tắc bảo vệ dữ liệu thật

1. **Không dùng chung secret/credential** giữa development, staging và production (`DATABASE_URL`, `ADMIN_PASSWORD`, `RATE_LIMIT_HMAC_KEY`, `PAYMENT_WEBHOOK_SECRET`, `SEPAY_API_KEY`).
2. **Không sao chép dữ liệu khách hàng thật từ production xuống dev/staging**; nếu cần dữ liệu gần thực tế cho staging, bắt buộc chạy bước ẩn danh PII trước khi nạp.
3. **Kiểm tra trước khi deploy**: luôn chạy `npm run predeploy:check` với đúng biến môi trường đích (kèm `EXPECTED_DATABASE_NAME`).
