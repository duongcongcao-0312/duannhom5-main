# Chính sách mật khẩu chuẩn hóa BookNest (`PASSWORD_POLICY`)

## 1. Quy tắc mật khẩu (`backend/auth.js`)

Áp dụng nhất quán qua hàm `validatePasswordPolicy(password, { email })` theo khuyến nghị NIST SP 800-63B & OWASP:

- **Độ dài**: tối thiểu **12 ký tự** (`PASSWORD_MIN_LENGTH`), tối đa **128 ký tự** (`PASSWORD_MAX_LENGTH`), không được chỉ gồm khoảng trắng.
- **Ký tự hợp lệ**: từ chối ký tự điều khiển (`\x00-\x1F`, `\x7F`).
- **Chống mật khẩu yếu**:
  - Yêu cầu tối thiểu **4 ký tự phân biệt** (từ chối mật khẩu lặp lại như `aaaaaaaaaaaa`).
  - Từ chối mật khẩu toàn chữ số (`123456789012`) và danh sách mật khẩu phổ biến/dễ đoán (`COMMON_WEAK_PASSWORDS` như `password1234`, `qwerty123456`, `admin1234567`, `booknest1234`, ...).
  - Từ chối mật khẩu trùng với địa chỉ email hoặc phần tên email của tài khoản.

## 2. Phạm vi áp dụng đồng nhất

Tất cả các luồng tạo/đổi/đặt lại mật khẩu đều dùng cùng một hàm kiểm tra `validatePasswordPolicy` / `isPasswordValid`:
- Đăng ký tài khoản: `POST /api/v1/auth/register`
- Đổi mật khẩu: `POST /api/v1/auth/change-password` (yêu cầu xác thực lại mật khẩu hiện tại, cấm trùng mật khẩu cũ, tự thu hồi phiên cũ và cấp phiên mới)
- Đặt lại mật khẩu: `POST /api/v1/auth/password-reset/confirm`
- Cấp tài khoản nhân viên: `POST /api/v1/admin/staff`

## 3. Thông báo lỗi an toàn

- Thông báo lỗi hướng dẫn rõ nguyên nhân (độ dài, mật khẩu yếu/phổ biến, trùng email) kèm mã lỗi chuẩn hóa (`PASSWORD_POLICY_LENGTH`, `PASSWORD_POLICY_WEAK`, `PASSWORD_POLICY_COMMON`, `PASSWORD_POLICY_PERSONAL`, `PASSWORD_POLICY_REUSE`) và **không bao giờ phản hồi lại chuỗi mật khẩu hay thông tin nhạy cảm**.
