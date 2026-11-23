# Đánh giá & Kiến trúc lưu phiên xác thực (`HttpOnly, Secure, SameSite` Cookie vs `sessionStorage`)

## 1. Đánh giá rủi ro `sessionStorage` so với Cookie `HttpOnly, Secure, SameSite`

| Tiêu chí | `sessionStorage` + Bearer token | Cookie `bn_session` (`HttpOnly`, `Secure`, `SameSite`) |
| --- | --- | --- |
| Phơi lộ token khi xảy ra XSS | **Cao** — bất kỳ đoạn JS nào chạy trong origin đều đọc được `sessionStorage.getItem(...)` và đánh cắp phiên. | **Giảm mạnh** — cờ `HttpOnly` chặn hoàn toàn `document.cookie` đọc token phiên. |
| Rủi ro CSRF | Thấp (trình duyệt không tự đính kèm `Authorization` header). | Cần kết hợp chặt chẽ **Origin/Referer validation** + **Double-submit CSRF token** (`bn_csrf_token` + `X-CSRF-Token`). |
| Vòng đời & thu hồi phiên | Tự xóa khi đóng tab, nhưng khó đồng bộ đa tab. | Server kiểm soát trực tiếp qua `Max-Age`, `logout` (`Max-Age=0`) và `SessionStore` thu hồi phía server. |
| Triển khai cross-origin (GitHub Pages -> Render) | Dễ hơn vì không phụ thuộc third-party cookie. | Yêu cầu `CORS_ORIGINS` allowlist rõ ràng, `Access-Control-Allow-Credentials: true`, `SameSite=None; Secure` (hoặc same-site domain). |

## 2. Phương án kiến trúc được chọn cho BookNest

BookNest áp dụng **chế độ hỗ trợ cookie `HttpOnly` ưu tiên an toàn cho trình duyệt, tương thích ngược Bearer token cho API/CI**:

1. **Cấp cookie phiên & CSRF trên mọi luồng cấp phiên** (`POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/social`, `POST /api/v1/auth/refresh`):
   - `bn_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=<ttl>` (tự động gắn `; Secure` khi chạy HTTPS hoặc `NODE_ENV=production`).
   - `bn_csrf_token=<csrf>; Path=/; SameSite=Lax; Max-Age=<ttl>` (tự động gắn `; Secure` khi HTTPS/production) để frontend đọc và gửi lại qua header `X-CSRF-Token`.
   - Hỗ trợ `SESSION_COOKIE_SAMESITE=Strict|Lax|None` (`None` chỉ được bật khi request/môi trường là `Secure`).
2. **Thu hồi & xóa cookie khi đăng xuất** (`POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all`):
   - Hủy phiên trong `SessionStore` phía server và trả `Set-Cookie` với `Max-Age=0` cho cả `bn_session` và `bn_csrf_token`.
3. **CORS có kiểm soát**:
   - Chỉ trả `Access-Control-Allow-Origin: <origin>` và `Access-Control-Allow-Credentials: true` khi `Origin` nằm trong allowlist `CORS_ORIGINS`; không bao giờ dùng wildcard `*`.
4. **Không làm suy giảm bảo vệ CSRF** (`backend/csrf.js`):
   - Mọi request thay đổi trạng thái (`POST`, `PUT`, `PATCH`, `DELETE`) trên `/api/*` (trừ webhook server-to-server) phải vượt qua kiểm tra `Origin` / `Referer` / `Sec-Fetch-Site`.
   - Khi request gửi kèm cookie (`bn_session` hoặc `bn_csrf_token`), bắt buộc khớp header `X-CSRF-Token` bằng so sánh `timingSafeEqual`; thiếu hoặc sai bị từ chối `403 CSRF_TOKEN_INVALID`.
