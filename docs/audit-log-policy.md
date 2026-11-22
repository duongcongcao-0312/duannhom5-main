# Chính sách & Quy trình Audit Log cho thao tác quản trị (BN-050)

## 1. Phạm vi thao tác được ghi audit
Mọi thao tác quản trị quan trọng đều được ghi vào tệp nhật ký kiểm toán (`data/admin-audit.jsonl` hoặc đường dẫn `auditLogPath` cấu hình):
- **Tất cả yêu cầu `/api/admin/*`:** ghi nhận lượt gọi (`admin.api.request`, `outcome: "attempt"`), kết quả bị từ chối quyền (`admin.api.denied`, `outcome: "denied"`, mã `401`/`403`) và kết quả thất bại (`admin.api.failure`, `outcome: "failure"`, mã `400`/`404`/`405`/`409`/`428`/`500`).
- **Quản trị nhân viên & người dùng:** `staff.profile.create`, `staff.profile.update`, `user.student_verification.update`.
- **Quản trị đơn hàng & thanh toán/hoàn tiền:** `order.status.update`, `order.payment.update`.
- **Quản trị danh mục, sách, mã ưu đãi & dịch vụ:** `book.create`, `book.update`, `book.delete`, `coupon.create`, `coupon.update`, `service.status.update`.
- **Quản trị CRM & quyền riêng tư (DSAR):** `customer.*`, `customer_interaction.*`, `privacy.data_request.update`, `privacy.export.*`.

## 2. Trường dữ liệu tối thiểu & loại trừ dữ liệu nhạy cảm
Mỗi bản ghi audit (`backend/audit.js` — `AUDIT_POLICY`) gồm các trường tối thiểu:
- `id` (UUID), `timestamp` (ISO-8601), `action`, `actorId`, `actorRole`, `entityType`, `entityId`, `outcome` (`attempt` | `success` | `denied` | `failure`), `statusCode`, `requestId`, `previousHash`, `hash`.
- **Loại trừ tuyệt đối:** `sanitizeAuditValue` loại bỏ các trường chứa mật khẩu, token, secret, authorization, cookie, session, số thẻ/CVV/PAN, API key, private key, access code, OTP/PIN, số tài khoản ngân hàng, email, số điện thoại, địa chỉ, tên khách hàng và ghi chú tự do; chuỗi còn lại được lọc qua `redactLogText`.

## 3. Thời hạn lưu trữ, bảo vệ chống sửa/xóa & phân quyền truy cập
- **Thời hạn lưu trữ (`retentionDays`):** mặc định **365 ngày** (`AUDIT_POLICY.retentionDays`) phục vụ điều tra sự cố an ninh và đối soát quản trị.
- **Bảo vệ chống sửa/xóa trái phép:**
  - Tệp `admin-audit.jsonl` chỉ ghi nối tiếp (append-only) qua hàng đợi tuần tự với quyền tệp `0600`.
  - Mỗi dòng gắn chuỗi băm SHA-256 (`previousHash` → `hash`); `readAuditEntries` xác minh toàn bộ chuỗi và báo lỗi ngay nếu phát hiện chỉnh sửa hoặc xóa dòng.
  - API `/api/admin/audit` chỉ cho phép `GET`; mọi yêu cầu `POST`, `PUT`, `PATCH`, `DELETE` đều bị từ chối với `405 Method Not Allowed` (sau khi kiểm tra quyền `read:audit`) và được ghi lại trong audit log.
- **Quyền truy cập log:** chỉ vai trò `admin` có quyền chuyên trách `read:audit` mới được gọi `GET /api/admin/audit` (hỗ trợ lọc `action`, `outcome`, `actorId`, `entityType`, phân trang `limit`/`offset`). Các vai trò khác (`sales`, `support`, `user`) nhận `403` và lượt truy cập trái phép được ghi `admin.api.denied`.
