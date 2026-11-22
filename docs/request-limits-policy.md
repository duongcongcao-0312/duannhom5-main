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
- **Lưu trữ cô lập & chống ghi đè:** không dùng tên tệp do client gửi; hệ thống sinh tên ngẫu nhiên `<uuid>.<ext>` lưu trong thư mục riêng (`uploadsDir`, mặc định `data/uploads/book-covers`) bằng ghi độc quyền (`flag: "wx"`, quyền `0600`) có kiểm tra containment bằng `path.resolve`.
- **Phục vụ an toàn:** `GET /api/uploads/book-covers/:filename` chỉ chấp nhận đúng mẫu UUID + `.jpg|.png|.webp` và luôn gắn `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox`.
