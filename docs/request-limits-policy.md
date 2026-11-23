# Chính sách Giới hạn Kích thước Request & Upload File (BN-049)

## 1. Giới hạn kích thước request body theo loại endpoint
Mọi yêu cầu API được kiểm tra giới hạn kích thước qua `backend/request-limits.js` (`REQUEST_LIMIT_POLICY`):

| Nhóm endpoint | Đường dẫn áp dụng | Giới hạn tối đa |
| --- | --- | --- |
| Xác thực & tài khoản (`auth`) | `/api/auth/*` | **16 KiB** (`16,384` bytes) |
| Webhook thanh toán (`webhooks`) | `/api/payments/webhook`, `/api/payments/sepay-webhook` | **32 KiB** (`32,768` bytes) |
| Dịch vụ (`services`) | `/api/services`, `/api/services/*` | **32 KiB** (`32,768` bytes) |
| Quyền riêng tư (`privacy`) | `/api/privacy/*` | **32 KiB** (`32,768` bytes) |
| Đơn hàng (`orders`) | `/api/orders`, `/api/orders/*` | **64 KiB** (`65,536` bytes) |
| CRM khách hàng (`customers`) | `/api/customers*`, `/api/admin/customers*` | **64 KiB** (`65,536` bytes) |
| Quản trị (`admin`) | `/api/admin/*` (trừ upload) | **128 KiB** (`131,072` bytes) |
| Tải tệp ảnh (`upload`) | `/api/admin/uploads/*` | **2 MiB** (`2,097,152` bytes) + `64 KiB` cho header `multipart/form-data` |
| Mặc định (`default`) | Các endpoint `/api/*` khác | **64 KiB** (`65,536` bytes) |
| Độ dài URL (`maxUrlLength`) | Mọi request | **2,048** ký tự (vượt trả `414 URI Too Long`) |

## 2. Từ chối sớm trước khi xử lý tốn kém
- **Kiểm tra header `Content-Length` và độ dài URL sớm:** thực hiện ngay đầu `handleRequest` (trước audit, rate-limit I/O, truy vấn DB, xác thực mật khẩu, xác minh chữ ký HMAC hoặc `JSON.parse`).
  - `Content-Length` không hợp lệ (âm, không phải số nguyên, trùng lặp) -> từ chối ngay với `400 Bad Request` (`INVALID_CONTENT_LENGTH`).
  - `Content-Length` vượt giới hạn nhóm endpoint -> từ chối ngay với `413 Payload Too Large` (`PAYLOAD_TOO_LARGE`, kèm `maxBytes`).
- **Kiểm soát luồng (streaming / chunked):** `readBoundedBody` cộng dồn dung lượng theo từng chunk; ngay khi vượt ngưỡng sẽ dừng đọc, không lưu chunk vượt quá vào bộ nhớ và trả `413` với `Connection: close`.
- **Kiểm tra `Content-Type` trước khi đọc body:** cả JSON (`application/json`) và upload (`multipart/form-data` hoặc `image/jpeg`, `image/png`, `image/webp`) đều từ chối sớm với `415 Unsupported Media Type` nếu sai định dạng.

## 3. Chính sách kiểm tra và lưu trữ an toàn cho Upload File
Endpoint `POST /api/admin/uploads/book-cover` (yêu cầu quyền `write:books`, có ghi audit log `book.cover.upload`):
- **Loại tệp cho phép (allowlist):** chỉ `image/jpeg`, `image/png`, `image/webp`. Từ chối tuyệt đối `image/svg+xml`, `text/html`, mã thực thi, script và `application/octet-stream`.
- **Xác minh nội dung (magic bytes):** đối chiếu chữ ký nhị phân thực tế của tệp (`FF D8 FF` cho JPEG, `89 50 4E 47 0D 0A 1A 0A` cho PNG, `RIFF....WEBP` cho WebP) khớp với `Content-Type` khai báo; từ chối tệp giả mạo định dạng với `400` (`INVALID_UPLOAD_CONTENT`).
- **Kiểm tra tên tệp:** chặn đường dẫn tương đối (`..`, `/`, `\`), ký tự điều khiển/null byte, tệp ẩn bắt đầu bằng `.`, tên dài quá 120 ký tự, phần mở rộng không khớp MIME và phần mở rộng kép nguy hiểm (`.php.png`, `.svg.jpg`, `.html.webp`, `.js.png`, `.exe.png`, ...).
- **Tối ưu & lưu trữ:** sau khi giải mã an toàn, ảnh được xoay theo EXIF, giữ tỷ lệ, giới hạn tối đa 1200×1800 và chuyển sang WebP chất lượng 82; hệ thống tạo thêm biến thể 640×960 và 320×480 (không phóng lớn ảnh nhỏ). Tên tệp UUID, không dùng tên client; các tệp được ghi độc quyền (`flag: "wx"`, quyền `0600`) với kiểm tra containment bằng `path.resolve`. Đầu ra trả kích thước gốc, kích thước tối ưu và URL cho từng biến thể.
- **Phục vụ an toàn:** `GET /api/uploads/book-covers/:filename` chỉ chấp nhận UUID cho ảnh WebP/biến thể và vẫn phục vụ tương thích các ảnh JPG/PNG đã lưu trước đây; luôn gắn `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox`.

## 4. Runtime, pagination và reverse proxy (BN-136)
- **Thời gian nhận/xử lý:** Node.js `requestTimeout` mặc định **30 giây**, cấu hình bằng `REQUEST_TIMEOUT_MS` trong khoảng 1–120 giây. Header timeout là 10 giây; socket inactivity timeout là 60 giây; PostgreSQL connection/query timeout là 10 giây. Proxy nên dùng `client_body_timeout` không thấp hơn request timeout và `proxy_read_timeout` tối thiểu 60 giây.
- **Concurrency:** tối đa **100 request đang xử lý trên mỗi instance**, cấu hình bằng `MAX_CONCURRENT_REQUESTS` (1–1000). Request vượt mức nhận `503`, `Retry-After: 1` và `Connection: close`; response được ghi vào HTTP request metrics/log theo route đã chuẩn hóa, status và duration, không ghi body/query/IP. Mỗi replica có hạn mức riêng; không xem đây là giới hạn tổng cụm.
- **Phân trang:** endpoint phân trang kiểm tra query theo schema; các danh sách chính giới hạn `limit` tối đa 100 và page tối đa 10.000. Audit list admin giới hạn riêng 200 bản ghi. URL vẫn bị giới hạn 2.048 ký tự.
- **Reverse proxy/gateway:** phải đặt body cap ít nhất 2.162.688 bytes (2 MiB file + 64 KiB multipart overhead) để upload hợp lệ không bị proxy từ chối trước ứng dụng; giới hạn lớn hơn ở proxy không làm tăng giới hạn ứng dụng. Giữ timeout upstream tối thiểu 60 giây và truyền status/`Retry-After` nguyên vẹn. Với Render, ingress do nền tảng quản lý; các giới hạn ứng dụng ở trên vẫn là giới hạn bắt buộc.

Ví dụ Nginx cho route upload và upstream (đặt `client_max_body_size` trong `server` hoặc `location`; cấu hình giới hạn body endpoint-specific cần giữ các giá trị lớn hơn cho upload):

```nginx
client_body_timeout 30s;
proxy_read_timeout 60s;
proxy_send_timeout 30s;

location /api/admin/uploads/ {
    client_max_body_size 2162688;
    proxy_pass http://booknest;
}

location /api/ {
    client_max_body_size 131072;
    proxy_pass http://booknest;
}
```

Không cấu hình một `client_max_body_size` 128 KiB ở cấp `server` nếu muốn route upload nhận được 2 MiB; Nginx location upload cần override như ví dụ. Khi thay đổi các giới hạn, cập nhật đồng thời `backend/request-limits.js`, schema phân trang, biến môi trường triển khai và reverse proxy/gateway. Kiểm thử giá trị đúng ngưỡng và ngưỡng +1 trước khi phát hành.
