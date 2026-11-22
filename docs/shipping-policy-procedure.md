# Quy trình vận hành giao nhận & xử lý sự cố vận chuyển (BN-191)

> **Lưu ý triển khai:** Trước khi mở bán chính thức, đơn vị vận hành cần đối chiếu lại biểu phí (20.000 đ / 30.000 đ / 45.000 đ), ngưỡng miễn phí (300.000 đ) và thời gian giao ước tính với hợp đồng thực tế của đối tác vận chuyển (GHN, GHTK, Viettel Post, v.v.).

## 1. Điểm công khai & đồng bộ
- **Trang công khai:** `shipping.html` (hiển thị liên kết tại `#checkoutPolicyNotice` trước nút **"Xác nhận đặt hàng"** trên `index.html`, tại footer của `index.html` & `book.html`, và liên kết chéo từ `returns.html`, `refund.html`, `terms.html`).
- **API công khai:** `GET /api/policies/shipping` trả về dữ liệu cấu hình từ `backend/shipping-policy.js`.
- **Đồng bộ email & thông báo:** mẫu thông báo đơn hàng cần đính kèm mã đơn hàng (UUID), thời gian giao ước tính và liên kết `shipping.html` + hướng dẫn tra cứu.
- **Đồng bộ CSKH:** sự cố giao hàng (chậm, thất bại, đổi địa chỉ) được nhân viên hỗ trợ (`support`) ghi nhận tương tác CRM (`/api/customers/:id/interactions`) và phối hợp `sales`/`admin` cập nhật trạng thái đơn.

## 2. Quy trình xử lý sự cố giao hàng
| Sự cố | Trạng thái đơn | Hành động chuẩn | Người phụ trách |
| --- | --- | --- | --- |
| Khách báo sai / đổi địa chỉ | `received` / `processing` | Xác nhận chủ đơn, cập nhật địa chỉ giao trước khi bàn giao vận chuyển (miễn phí). | CSKH (`support`) / Sales (`sales`) |
| Khách báo sai / đổi địa chỉ | `shipping` | Liên hệ hãng vận chuyển kiểm tra khả năng chuyển tuyến & báo phụ phí thực tế (nếu có) trước khi xác nhận. | CSKH (`support`) |
| Giao thất bại lần 1–3 | `shipping` | Hãng vận chuyển giao lại tối đa 3 lần trong 3 ngày làm việc; CSKH nhắc lịch nhận nếu khách yêu cầu. | Đối tác vận chuyển & CSKH |
| Hoàn về kho sau 3 lần thất bại | `shipping` → `cancelled` | Xác nhận với khách: tạo đơn giao lại hoặc hủy đơn & chuyển quy trình hoàn tiền (nếu đơn đã `paid`). | CSKH & Admin (`write:orders`) |
| Chậm quá thời gian ước tính | `processing` / `shipping` | Tra soát hãng vận chuyển, phản hồi khách ≤ 1 ngày làm việc; hỗ trợ hủy & hoàn 100% nếu quá cam kết bổ sung. | CSKH & Admin |
