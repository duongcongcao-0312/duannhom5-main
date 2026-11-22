# Quy trình quản lý & áp dụng Điều khoản sử dụng (BN-190)

> **Lưu ý pháp lý:** Trước khi vận hành kinh doanh chính thức, đơn vị vận hành cần xác nhận nội dung Điều khoản sử dụng, thông tin pháp nhân, đầu mối khiếu nại và giới hạn trách nhiệm với chuyên gia pháp lý hoặc cơ quan có thẩm quyền.

## 1. Điểm công khai & khả năng truy cập trước giao dịch
- **Trang công khai:** `terms.html` (phiên bản `2026-01`) và API `GET /api/policies/terms` (`backend/terms-policy.js`).
- **Trước khi đăng ký tài khoản:** hiển thị `#registerPolicyNotice` kèm liên kết `terms.html` và `privacy.html` ngay trước nút **"Tạo tài khoản"** trong `#registerForm` (`index.html`).
- **Trước khi đặt hàng:** hiển thị `#checkoutPolicyNotice` kèm liên kết `shipping.html`, `returns.html`, `refund.html`, `terms.html` ngay trước nút **"Xác nhận đặt hàng"** trong `#paymentDialog` (`index.html`).
- **Điều hướng toàn trang:** liên kết đầy đủ bộ chính sách trong footer của `index.html`, `book.html` và liên kết chéo giữa cả 5 trang pháp lý (`terms.html`, `shipping.html`, `returns.html`, `refund.html`, `privacy.html`).

## 2. Quy trình cập nhật điều khoản & xử lý khiếu nại
1. **Rà soát & cập nhật phiên bản:** khi có thay đổi nghiệp vụ (thanh toán, vận chuyển, đổi trả, hoàn tiền, bảo vệ dữ liệu), cập nhật đồng bộ `backend/terms-policy.js`, `terms.html` và các chính sách liên quan; tăng mã phiên bản (`version`).
2. **Thông báo trước hiệu lực:** công bố thay đổi quan trọng trên `terms.html` trước ít nhất **7 ngày**; giữ bản ghi kiểm soát phiên bản trên Git.
3. **Tiếp nhận & xử lý khiếu nại:** CSKH (`support`) tiếp nhận qua kênh hỗ trợ chính thức, phản hồi ban đầu trong **2 ngày làm việc**, ghi nhận tương tác CRM (`/api/customers/:id/interactions`) và chuyển cấp Quản trị viên (`admin`) nếu có tranh chấp hoặc vi phạm điều khoản cần khóa tài khoản.
