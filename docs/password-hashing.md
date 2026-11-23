# Chính sách & Kế hoạch nâng cấp thuật toán băm mật khẩu (`scrypt`)

## 1. Thuật toán & cấu hình hiện hành (`backend/auth.js`)

- **Thuật toán**: `scrypt` (memory-hard password-based KDF theo khuyến nghị OWASP, tích hợp sẵn trong `node:crypto`).
- **Salt**: 16 byte ngẫu nhiên từ CSPRNG (`crypto.randomBytes(16)`) riêng biệt cho từng mật khẩu, chống tấn công rainbow table và tương quan giữa các tài khoản trùng mật khẩu.
- **Chi phí tính toán (`PASSWORD_HASH_PARAMS`)**:
  - `N = 16384` (CPU/memory cost)
  - `r = 8` (block size)
  - `p = 1` (parallelization)
  - `keylen = 64` byte (512-bit derived key)
  - `maxmem = 64 MiB`
- **Định dạng lưu trữ có phiên bản**:
  - `scrypt$N=16384,r=8,p=1$<saltHex>$<hashHex>`
- **Xác minh an toàn**:
  - Đọc tham số trực tiếp từ chuỗi hash đã lưu và so sánh bằng `crypto.timingSafeEqual` (sau khi kiểm tra độ dài buffer khớp nhau) để chống timing attack.

## 2. Kế hoạch chuyển đổi & nâng cấp hash cũ không gián đoạn

1. **Tương thích ngược**: `verifyPassword()` hỗ trợ xác minh đồng thời định dạng mới (`scrypt$N=...,r=...,p=...$<salt>$<hash>`) và định dạng cũ (`<salt>:<hash>`).
2. **Tự động nâng cấp khi đăng nhập (transparent on-login rehash)**:
   - Sau khi xác minh mật khẩu hợp lệ tại `POST /api/v1/auth/login`, hệ thống kiểm tra `needsPasswordRehash(user.password)`.
   - Nếu hash là định dạng cũ (`salt:hash`) hoặc có tham số `N`/`r`/`p`/`keylen` khác `PASSWORD_HASH_PARAMS`, hệ thống tự động băm lại bằng `hashPassword(password)` và lưu qua `db.updateUserPasswordHash(user.id, newHash)` kèm sự kiện audit `auth.password.rehashed`.
3. **Nâng cấp chi phí trong tương lai**: chỉ cần tăng `N`/`r`/`p` trong `PASSWORD_HASH_PARAMS` — toàn bộ tài khoản cũ vẫn đăng nhập bình thường và tự động nâng cấp dần sang tham số mới.

## 3. Chống rò rỉ mật khẩu & hash

- Mật khẩu thô không bao giờ được lưu xuống DB, không trả về qua `publicUser()`, và bị lọc khỏi log/audit (`redactLogText`, `SENSITIVE_AUDIT_KEY_PATTERN`).
- Chuỗi hash mật khẩu chỉ lưu trong bảng/file `users`, không bao giờ xuất hiện trong phản hồi API hay nhật ký hệ thống.
