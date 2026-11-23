# Rà soát nghĩa vụ bảo vệ người tiêu dùng, thuế & hóa đơn (`BN-202` / Issue #179)

> **Lưu ý quan trọng:** Tài liệu này là kết quả rà soát quy trình vận hành và tuân thủ kỹ thuật của dự án BookNest, **không phải ý kiến tư vấn pháp lý hoặc thuế**. Trước khi vận hành kinh doanh chính thức, đơn vị vận hành bắt buộc phải xác nhận với luật sư, đơn vị kế toán – thuế hoặc cơ quan nhà nước có thẩm quyền.

## 1. Rà soát nghĩa vụ bảo vệ người tiêu dùng

| Hạng mục | Hiện trạng hệ thống & chính sách công khai | Nơi kiểm chứng |
| --- | --- | --- |
| **Minh bạch giá bán & phí** | Niêm yết giá bằng `VND`, server tính lại tạm tính, chiết khấu thành viên/sinh viên, mã ưu đãi và hiển thị tổng cuối cùng cùng chính sách miễn phí vận chuyển từ `300.000 đ` trước khi xác nhận đặt hàng. | `server.js` (`createOrder`), `shipping.html`, `#checkoutPolicyNotice` |
| **Điều kiện giao dịch chung** | Công khai điều khoản tài khoản, đặt hàng, thanh toán COD/chuyển khoản, hủy đơn, thay đổi điều khoản (thông báo trước 7 ngày) trước khi đăng ký và trước khi thanh toán. | `terms.html`, `backend/terms-policy.js`, `index.html` |
| **Hỗ trợ khách hàng & khiếu nại** | Tiếp nhận qua kênh CSKH (`support`), phản hồi ban đầu trong **2 ngày làm việc**, ghi nhận tương tác CRM (`/api/v1/customers/:id/interactions`) và chuyển cấp Quản trị viên (`admin`) khi có tranh chấp. | `terms.html#termsComplaints`, `consumer-tax.html#consumerSupportRefunds` |
| **Đổi trả & hoàn tiền** | Công khai quy trình đổi trả trong **7 ngày** (`returns.html`), thời gian hoàn tiền **3–5 ngày làm việc** (`refund.html`), không thu thập số thẻ thanh toán. | `returns.html`, `refund.html`, `backend/return-policy.js`, `backend/refund-policy.js` |
| **Bảo vệ dữ liệu cá nhân** | Công khai chính sách bảo mật, quản lý consent, xuất dữ liệu JSON và quy trình DSAR (`privacy.html`). | `privacy.html`, `docs/privacy-request-procedure.md` |

## 2. Đối chiếu mô hình kinh doanh với nghĩa vụ thuế, chứng từ & hóa đơn

| Dòng doanh thu / nghiệp vụ | Nghĩa vụ tiềm năng cần xác nhận với kế toán / cơ quan thuế | Yêu cầu dữ liệu từ hệ thống |
| --- | --- | --- |
| **Bán lẻ sách trực tuyến (COD & chuyển khoản VietQR/SePay)** | Đăng ký pháp nhân (hộ kinh doanh hoặc doanh nghiệp); xác định chế độ thuế GTGT (lưu ý nhóm sách/xuất bản phẩm có thể thuộc đối tượng không chịu thuế hoặc thuế suất riêng tùy danh mục), thuế TNDN/TNCN; phát hành **hóa đơn điện tử** theo từng lần bán hàng khi thuộc diện áp dụng. | Mã đơn hàng (`orderId`), ngày tạo, danh sách sách/số lượng/đơn giá/chiết khấu/tổng tiền, trạng thái thanh toán, mã đối soát `BN...`. |
| **Dịch vụ thuê sách** | Xác định thuế GTGT/TNDN/TNCN đối với doanh thu cho thuê và chứng từ đặt cọc/hoàn cọc (nếu có). | Mã yêu cầu dịch vụ, thông tin hợp đồng/biên nhận giao nhận sách. |
| **Thu mua & trao đổi sách cũ** | Lập bảng kê thu mua hàng hóa không có hóa đơn (nếu mua từ cá nhân không kinh doanh) và hạch toán giá vốn/doanh thu theo hướng dẫn kế toán. | Biên bản định giá, phiếu chi/chuyển khoản và bảng kê thu mua. |
| **Hoàn tiền / hủy đơn đã thanh toán** | Quy trình lập hóa đơn điều chỉnh/thay thế hoặc hủy hóa đơn điện tử tương ứng với giao dịch hoàn tiền. | Mã đơn hàng gốc, chứng từ hoàn tiền, nhật ký cập nhật `paymentStatus: "refunded"`. |

## 3. Quy trình phối hợp kế toán / pháp lý & lưu trữ hồ sơ

1. **Tiếp nhận yêu cầu hóa đơn / khiếu nại (`support`):**
   - Thu thập thông tin bắt buộc: mã đơn hàng (`orderId`), tên cá nhân/đơn vị, mã số thuế, địa chỉ xuất hóa đơn và email nhận hóa đơn điện tử.
   - Ghi nhận yêu cầu vào lịch sử tương tác CRM (`/api/v1/customers/:id/interactions`) và chuyển bộ phận kế toán đối chiếu.
2. **Đối soát đơn hàng & giao nhận (`sales`):**
   - Xác nhận trạng thái giao hàng (`shipping` / `completed`) và trạng thái đổi trả/hủy đơn; không tự ý thay đổi `paymentStatus`.
3. **Xác nhận thanh toán & chốt sổ đối chiếu (`admin` + Kế toán/Pháp lý):**
   - Chỉ `admin` hoặc webhook thanh toán đã xác thực chữ ký/API key mới xác nhận `paymentStatus: "paid"` hoặc `"refunded"`.
   - Định kỳ chốt bảng kê đơn hàng, giao dịch SePay/COD, giao dịch hoàn tiền và nhật ký kiểm toán (`GET /api/v1/admin/audit`) chuyển bộ phận kế toán kê khai thuế và lưu trữ hóa đơn điện tử.
   - Rà soát pháp lý định kỳ trước khi mở rộng hình thức kinh doanh mới hoặc thay đổi chính sách giá/thuế/hóa đơn.
4. **Lưu trữ hồ sơ & đồng bộ quyền riêng tư:**
   - Chứng từ kế toán, bảng kê đơn hàng, đối soát ngân hàng và hóa đơn điện tử được lưu trữ có kiểm soát theo thời hạn luật kế toán (tham chiếu **5–10 năm**, xác nhận chính xác với kế toán theo loại chứng từ).
   - Khi người dùng yêu cầu xóa dữ liệu cá nhân (DSAR `delete`), hệ thống ẩn danh thông tin định danh tài khoản nhưng **giữ nguyên bản ghi đơn hàng lịch sử** để không làm sai lệch sổ sách kế toán.

## 4. Điểm công khai chính sách

- Trang công khai: `consumer-tax.html` (phiên bản `2026-01`).
- API công khai: `GET /api/policies/consumer-tax` và `GET /api/v1/policies/consumer-tax` (`backend/consumer-tax-policy.js`).
- Liên kết điều hướng: footer của `index.html` và trang `terms.html` cùng các trang chính sách liên quan.
