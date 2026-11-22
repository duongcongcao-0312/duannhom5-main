# Quy trình vận hành đổi trả hàng & giải quyết khiếu nại (BN-192)

> **Lưu ý pháp lý:** Trước khi vận hành kinh doanh chính thức, đơn vị vận hành cần rà soát các điều kiện đổi trả, thời hạn 7 ngày, chi phí vận chuyển và quyền lợi người tiêu dùng với chuyên gia pháp lý hoặc cơ quan có thẩm quyền.

## 1. Công khai trước khi mua & điểm đồng bộ
- **Trang công khai:** `returns.html` (hiển thị liên kết trước khi mua trên trang chi tiết sách `book.html`/`book-detail.js`, ngay trước nút **"Xác nhận đặt hàng"** trong `#paymentDialog` của `index.html`, và trong footer toàn trang).
- **API công khai:** `GET /api/policies/return` trả về cấu trúc chính sách chuẩn từ `backend/return-policy.js`.
- **Đồng bộ hoàn tiền:** mọi yêu cầu đổi trả chọn phương án hoàn tiền được chuyển trực tiếp sang quy trình `docs/refund-policy-procedure.md` (`refund.html`).
- **Đồng bộ CSKH / khiếu nại:** nhân viên hỗ trợ (`support`) ghi nhận lịch sử trao đổi bằng CRM interaction (`POST /api/customers/:id/interactions`, loại `support`/`order`), không lưu thông tin nhạy cảm vào log hệ thống.

## 2. Phân công trách nhiệm & thời hạn nội bộ
| Bước | Người phụ trách | Thời hạn mục tiêu | Đầu ra |
| --- | --- | --- | --- |
| 1. Tiếp nhận & kiểm tra bằng chứng | CSKH (`support`) | ≤ 2 ngày làm việc | Xác nhận đủ/không đủ điều kiện theo `evaluateReturnEligibility` |
| 2. Phân loại phí vận chuyển | CSKH (`support`) | Cùng bước 1 | `booknest` (lỗi in/vận chuyển/giao sai) hoặc `customer` (đổi ý) |
| 3. Nhận & kiểm tra hàng hoàn | Vận hành / Kho | ≤ 1 ngày làm việc từ khi nhận kiện | Biên bản kiểm tra tình trạng sách & phụ kiện |
| 4. Đổi sách mới hoặc chuyển hoàn tiền | Sales / Admin (`write:orders`) | 2–3 ngày làm việc (đổi) / 3–5 ngày làm việc (hoàn tiền) | Gửi đơn đổi hoặc cập nhật `paymentStatus: "refunded"` |
| 5. Chuyển cấp khiếu nại (nếu có tranh chấp) | Quản trị viên (`admin`) | ≤ 3 ngày làm việc | Kết luận xử lý và thông báo khách hàng |
