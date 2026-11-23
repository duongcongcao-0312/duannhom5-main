# Quy trình thu hồi phiên & phản ứng khi tài khoản bị xâm nhập (`BN-032` / Issue #173)

## 1. Dấu hiệu kích hoạt
- Người dùng báo mất thiết bị, nghi lộ mật khẩu hoặc phát hiện hoạt động bất thường.
- Phát hiện nhiều lần đăng nhập/đổi SĐT/xuất dữ liệu thất bại liên tiếp trong audit log hoặc cảnh báo từ hệ thống giám sát.
- Nhân viên nghỉ việc hoặc bị nghi ngờ lộ thông tin đăng nhập.

## 2. Cơ chế thu hồi toàn bộ phiên, refresh token & token liên quan

Mọi phiên đăng nhập trên BookNest lưu tập trung tại `SessionStore` phía backend (gắn đồng thời `token` và `refreshTokenHash`). Khi thu hồi theo `userId`:
- **Toàn bộ access session token & refresh token** trên mọi thiết bị lập tức bị vô hiệu hóa (`sessionStore.destroyUserSessions(userId)`).
- **Toàn bộ bản xuất dữ liệu cá nhân & `X-Export-Token` đang còn hiệu lực** bị hủy ngay lập tức (`privacyExportStore.purgeUserExports(userId)`).
- **Token đặt lại mật khẩu cũ** (nếu có) bị xóa khi bật cờ buộc đổi mật khẩu (`markPasswordResetRequired`).

### Hai kênh thực thi
1. **Tự phục vụ của chủ tài khoản:**
   - Gọi `POST /api/v1/auth/logout-all` (với Bearer token hiện tại).
   - Hệ thống thu hồi toàn bộ phiên trên mọi thiết bị, hủy các bản xuất dữ liệu đang hoạt động và ghi sự kiện `auth.sessions.revoke_all` vào audit log.
2. **Phản ứng khẩn cấp của Quản trị viên (`admin` có quyền `write:users`):**
   - Gọi `POST /api/v1/admin/users/:id/revoke-sessions` với payload `{ "forcePasswordReset": true, "reason": "suspected_compromise" }`.
   - Đối với nhân viên (`sales`/`support`), Admin cũng có thể vô hiệu hóa tài khoản qua `PATCH /api/v1/admin/staff/:id` (`{ "isActive": false }`) — hệ thống lập tức thu hồi toàn bộ phiên của nhân viên đó.
   - Hệ thống ghi sự kiện `security.account.sessions_revoked` vào `admin-audit.jsonl` (tuyệt đối không ghi mật khẩu hay token).

## 3. Quy trình buộc đổi mật khẩu & khôi phục quyền truy cập
1. Khi `forcePasswordReset: true`, tài khoản được gắn cờ `mustResetPassword = true`. Mọi nỗ lực đăng nhập bằng mật khẩu cũ đều bị chặn với `403 PASSWORD_RESET_REQUIRED`.
2. Chủ tài khoản thực hiện quy trình đặt lại mật khẩu an toàn:
   - Gửi yêu cầu `POST /api/v1/auth/password-reset` (email xác minh + token 256-bit băm lưu 1 giờ).
   - Xác nhận mật khẩu mới (12–128 ký tự) tại `POST /api/v1/auth/password-reset/confirm`.
3. Hoàn tất đổi mật khẩu tự động xóa cờ `mustResetPassword`, xóa token khôi phục và thu hồi mọi phiên cũ còn sót lại; người dùng đăng nhập lại bình thường bằng mật khẩu mới.

## 4. Kiểm chứng tự động
- `tests/session-revocation.test.js` kiểm thử đầy đủ thu hồi đa thiết bị (`logout-all`), cưỡng chế thu hồi & buộc đổi mật khẩu của Admin, vô hiệu hóa token/refresh token/export token cũ, khôi phục đăng nhập sau khi đổi mật khẩu và ghi nhận sự kiện bảo mật trên audit log.
