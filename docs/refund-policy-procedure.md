# Quy trình vận hành đổi trả & hoàn tiền (BN-193)

> **Lưu ý pháp lý:** Đơn vị vận hành cần rà soát thời hạn, mức hoàn, trách nhiệm chi phí vận chuyển và nghĩa vụ hóa đơn/chứng từ với chuyên gia pháp lý hoặc cơ quan có thẩm quyền trước khi kinh doanh thực tế.

## 1. Phạm vi & liên kết chính sách
- **Trang công khai cho khách hàng:** `refund.html` (hiển thị liên kết ngay trước nút **"Xác nhận đặt hàng"** trong hộp thoại thanh toán `#paymentDialog` và tại footer toàn trang).
- **API công khai:** `GET /api/policies/refund` trả về cấu trúc chính sách chuẩn (`backend/refund-policy.js`).
- **Đồng bộ thanh toán:** gắn trực tiếp với đối soát chuyển khoản SePay (`BN...` → `paymentStatus: "paid"`) và thu hộ COD (`paymentMethod: "cod"` + `status: "completed"`).
- **Đồng bộ CSKH:** mọi yêu cầu hoàn tiền có thể được ghi nhận tương tác khách hàng trong CRM (`/api/customers/:id/interactions`, loại `support`/`order`), không lưu thông tin tài khoản ngân hàng vào nhật ký kiểm toán hệ thống.

## 2. Điều kiện, mức hoàn & thời gian xử lý
| Trường hợp | Mức hoàn | Điều kiện | Thời hạn xử lý |
| --- | --- | --- | --- |
| Hủy đơn chuyển khoản trước khi giao | 100% | Đơn đã `paid`, hủy trước khi bàn giao vận chuyển | Duyệt ≤ 2 ngày làm việc; hoàn 3–5 ngày làm việc |
| Sách lỗi in ấn / hư hỏng / giao sai hoặc thiếu | 100% (hoặc đổi mới miễn phí) | Thông báo trong 7 ngày kể từ ngày nhận kèm ảnh/video | Duyệt ≤ 2 ngày làm việc; hoàn 3–5 ngày làm việc |
| Hết hàng sau khi đã thanh toán | 100% | Kho xác nhận không đủ hàng, khách chọn hoàn tiền | Duyệt ≤ 2 ngày làm việc; hoàn 3–5 ngày làm việc |
| Khách đổi ý trả hàng trong 7 ngày | 100% giá trị sách (trừ phí ship hai chiều nếu có) | Sách nguyên trạng, chưa sử dụng, đủ phụ kiện | Kiểm tra hàng hoàn + hoàn 3–5 ngày làm việc |

## 3. Quy trình thực thi 5 bước
1. **Tiếp nhận (CSKH — `support`):** nhận mã đơn hàng, lý do hoàn và bằng chứng kiểm tra hàng; tạo tương tác hỗ trợ (không chứa số tài khoản nhạy cảm trong log chung).
2. **Kiểm tra điều kiện & đối soát:**
   - Kiểm tra thời hạn đổi trả 7 ngày và tình trạng hàng hoàn (nếu đã giao).
   - Đối soát giao dịch: đơn chuyển khoản phải có `paymentStatus: "paid"` và khớp mã thanh toán `BN...` trên SePay; đơn COD phải đã hoàn tất giao & thu tiền (`status: "completed"`).
3. **Phê duyệt (`admin` có quyền `write:orders`):** xác nhận đủ điều kiện, mức hoàn và phương thức hoàn (hoàn về nguồn thanh toán với `transfer`; chuyển khoản tài khoản chính chủ với `cod`).
4. **Thực hiện chuyển hoàn:** kế toán/vận hành chuyển khoản và lưu chứng từ đối soát kế toán.
5. **Cập nhật trạng thái hệ thống:** Admin gọi `PATCH /api/admin/orders/:id` với `{ paymentStatus: "refunded" }`.
   - Backend (`backend/refund-policy.js`) bắt buộc chặn hoàn tiền cho đơn chưa thanh toán (`400`) và chặn chuyển ngược từ `refunded` sang trạng thái khác (`409`).
   - Hệ thống tự động ghi sự kiện kiểm toán `order.status.update` với `paymentStatus: "refunded"`.
