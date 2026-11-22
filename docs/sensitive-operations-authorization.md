# Danh mục & Kiểm soát Quyền Backend cho Thao tác Nhạy cảm (BN-044)

## 1. Nguyên tắc ranh giới tin cậy (Server-Side Trust Boundary)
- Mọi thao tác nhạy cảm đều được xác minh trực tiếp phía backend (`backend/authorization.js`, `backend/router.js`, `backend/routes/*.js`) trước khi đọc hoặc ghi dữ liệu.
- **Không tin cậy dữ liệu quyền từ client:** không dựa vào việc ẩn/khóa nút UI; mọi giá trị client gửi lên như `role`, `permissions`, `studentVerificationStatus`, `discountRate`, `price`, `subtotal`, `discount`, `total` đều bị từ chối hoặc máy chủ tự tính lại từ nguồn sự thật trong cơ sở dữ liệu.

## 2. Danh mục 7 nhóm thao tác nhạy cảm (`SENSITIVE_OPERATIONS_CATALOG`)

| Nhóm thao tác | Endpoint chính | Kiểm soát bắt buộc tại backend |
| --- | --- | --- |
| **1. Dữ liệu tài khoản** | `/api/v1/auth/me`, `/api/v1/auth/customer-info`, `/api/v1/auth/social/link\|unlink`, `/api/v1/privacy/*` | Xác thực phiên (`401`), kiểm tra chính chủ `ownerId === requester.userId` (`403`), xác thực lại mật khẩu/phiên gần đây (`428`) với thay đổi nhạy cảm |
| **2. Đơn hàng** | `/api/v1/orders`, `/api/v1/orders/:id`, `/api/v1/admin/orders*` | Chính chủ hoặc `X-Order-Access-Code` (đơn khách); người mua/nhân viên không có `write:orders` chỉ được hủy đơn của mình, bị chặn `403` khi đổi `paymentStatus`, `items` hoặc chuyển trạng thái hoàn tất |
| **3. Địa chỉ & thông tin liên hệ** | `/api/v1/auth/customer-info`, `/api/v1/orders/:id` | Không tiết lộ địa chỉ/SĐT trong tra cứu công khai; cập nhật chỉ áp dụng cho chính tài khoản đăng nhập |
| **4. Giá bán & mã ưu đãi** | `/api/v1/orders/quote`, `/api/v1/orders`, `/api/v1/admin/coupons*`, `/api/v1/admin/users/:id` | Máy chủ tự tính giá, ưu đãi sinh viên đã xác minh và mã giảm giá; quản trị coupon/xác minh sinh viên yêu cầu quyền `write:coupons` / `write:users` (`admin`) |
| **5. Tồn kho & danh mục sách** | `/api/v1/admin/books*`, `/api/v1/admin/categories*`, `/api/v1/admin/authors*`, `/api/v1/admin/publishers*`, `/api/v1/admin/uploads/book-cover` | Yêu cầu `read:books` / `write:books` (`admin`), kiểm tra giữ chỗ tồn kho khi sửa số lượng |
| **6. Thanh toán** | `/api/v1/payments/webhook`, `/api/v1/payments/sepay-webhook`, `/api/v1/admin/orders/:id` | Xác minh chữ ký `HMAC-SHA256` / `Apikey` bằng so sánh hằng thời gian (`timingSafeEqual`); cập nhật trạng thái thanh toán quản trị yêu cầu `write:orders` |
| **7. Quản trị, CRM & Audit** | `/api/v1/admin/stats`, `/api/v1/admin/monitoring`, `/api/v1/admin/staff*`, `/api/v1/admin/audit`, `/api/v1/customers*`, `/api/v1/admin/privacy/*` | Phân quyền tối thiểu theo ma trận RBAC (`ROLE_PERMISSIONS`, `CUSTOMER_ROLE_PERMISSIONS`), ghi audit log mọi lượt bị từ chối `401`/`403` |
