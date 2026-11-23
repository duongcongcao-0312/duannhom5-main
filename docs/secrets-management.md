# Quản lý Secret & Biến môi trường (`BN-030` / Issue #171)

## 1. Nguyên tắc bảo vệ secret
- **Không commit secret thật vào repository:** `.env` và `.env.*` bị loại trừ trong `.gitignore` (chỉ giữ `.env.example` với giá trị rỗng cho mọi secret). Trong `render.yaml`, toàn bộ biến nhạy cảm được khai báo `sync: false` để chỉ cấu hình trong Secret Manager của môi trường triển khai (Render / GitHub Actions Secrets / Vault).
- **Không in secret ra log hay thông báo lỗi:** `scripts/predeploy-check.js` báo rõ tên biến bị thiếu hoặc sai định dạng (độ dài, giao thức) nhưng **không bao giờ in giá trị biến**; `backend/monitoring.js` (`redactLogText`, `redactLogObject`) tự động che toàn bộ secret cấu hình từ `process.env`.
- **Phân tách tuyệt đối theo môi trường (`development`, `staging`, `production`):** mỗi môi trường sử dụng `DATABASE_URL`, `ADMIN_PASSWORD`, `RATE_LIMIT_HMAC_KEY`, `SEPAY_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `BACKUP_ENCRYPTION_KEY`, `SMTP_PASSWORD`/`RESEND_API_KEY` riêng biệt; không dùng lại secret production cho máy local hay staging.

## 2. Danh mục Secret & Phân loại biến môi trường

| Biến môi trường | Loại | Bắt buộc Production | Yêu cầu kỹ thuật | Chu kỳ luân chuyển khuyến nghị |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Secret | Có | PostgreSQL URI (`postgres://` / `postgresql://`, TLS) | 90 ngày hoặc ngay khi lộ |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Secret | Có | Email hợp lệ; mật khẩu ≥ 12 ký tự (không khoảng trắng trống), riêng biệt | 90 ngày |
| `RATE_LIMIT_HMAC_KEY` | Secret | Có | ≥ 32 byte ngẫu nhiên (`openssl rand -hex 32`) | 180 ngày |
| `SEPAY_API_KEY` | Secret | Có | API key từ SePay Dashboard | 90–180 ngày |
| `PAYMENT_WEBHOOK_SECRET` | Secret | Khi bật webhook | ≥ 32 byte ngẫu nhiên dùng ký HMAC-SHA256 | 90–180 ngày |
| `BACKUP_ENCRYPTION_KEY` | Secret | Khi `BACKUP_ENCRYPTION_REQUIRED=true` | Khóa AES-256-GCM 32 byte dạng Base64 | 180 ngày (giữ bản cũ trong kho khóa để giải mã backup còn hạn 30 ngày) |
| `SMTP_PASSWORD` / `RESEND_API_KEY` | Secret | Khi bật khôi phục mật khẩu | Credential nhà cung cấp email | 90–180 ngày |
| `FIREBASE_API_KEY` | Secret / Config | Khi bật social login | Web API key cho backend verify ID Token; `assets/firebase-config.js` là public client config và **bắt buộc giới hạn HTTP Referrer** trên Google Cloud Console | Theo chính sách dự án Firebase |
| `MONITORING_ALERT_WEBHOOK_URL` | Secret | Tùy chọn | HTTPS URL không nhúng user/pass | Khi đổi kênh cảnh báo |
| `CORS_ORIGINS`, `PUBLIC_APP_URL`, `HOST`, `PORT`, `NODE_ENV` | Non-secret | Có | `CORS_ORIGINS` phải dùng `https://` ở production | Khi đổi tên miền |

## 3. Quyền truy cập, luân chuyển & thu hồi secret
1. **Quyền truy cập tối thiểu (Least Privilege):** Chỉ quản trị hạ tầng được quyền xem/cập nhật secret trên môi trường production; developer chỉ dùng `.env` cục bộ với dữ liệu phát triển.
2. **Luân chuyển định kỳ (Rotation):** Tạo khóa mới trên nhà cung cấp dịch vụ → cập nhật vào Secret Manager → triển khai lại và kiểm tra `npm run predeploy:check` + `/ready` → vô hiệu hóa khóa cũ.
3. **Thu hồi khẩn cấp khi nghi lộ secret:**
   - Thu hồi/đổi ngay key trên dịch vụ tương ứng (PostgreSQL, SePay, Resend/SMTP, webhook secret).
   - Nếu nghi lộ `ADMIN_PASSWORD`, đổi mật khẩu và gọi `POST /api/v1/admin/users/:id/revoke-sessions` (`forcePasswordReset: true`) để hủy toàn bộ phiên cũ.
   - Quét repository bằng `gitleaks` (đã tích hợp CI) và ghi nhận sự cố.

## 4. Hướng dẫn cấu hình an toàn (không đưa bí mật vào Git)
1. Sao chép mẫu: `cp .env.example .env` (file `.env` đã có trong `.gitignore`).
2. Điền giá trị phát triển cục bộ vào `.env` (không bao giờ commit `.env`).
3. Trước khi deploy production, chạy `npm run predeploy:check` để xác minh đầy đủ cấu hình bắt buộc.
