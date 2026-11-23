# Hồ sơ rà soát nghĩa vụ pháp lý website TMĐT tại Việt Nam (`BN-201` / Issue #178)

> **Lưu ý quan trọng:** Đây là đầu việc chuẩn bị và hồ sơ rà soát tuân thủ nội bộ của dự án BookNest, **không thay thế việc xác nhận nghĩa vụ pháp lý với cơ quan nhà nước có thẩm quyền (Bộ Công Thương, cơ quan thuế, cơ quan quản lý chuyên ngành) hoặc luật sư có chuyên môn** trước khi vận hành kinh doanh chính thức.

## 1. Xác định mô hình website, vai trò bên vận hành & phạm vi cung cấp

- **Loại hình website:** **Website thương mại điện tử bán hàng** (website do chủ sở hữu tự thiết lập để phục vụ hoạt động xúc tiến thương mại, bán hàng hóa và cung ứng dịch vụ trực tiếp của chính mình — **không** vận hành mô hình sàn giao dịch TMĐT cho thương nhân/tổ chức thứ ba mở gian hàng).
- **Vai trò bên vận hành:** Trực tiếp là bên bán hàng hóa và bên cung ứng dịch vụ; chịu trách nhiệm niêm yết thông tin sách, xác nhận đơn hàng, giao nhận, bảo vệ dữ liệu cá nhân và giải quyết khiếu nại.
- **Hoạt động cung cấp hàng hóa/dịch vụ:**
  1. Bán lẻ sách trực tuyến (thanh toán COD và chuyển khoản ngân hàng qua VietQR/SePay).
  2. Dịch vụ thuê sách (tiếp nhận yêu cầu trực tuyến qua `/api/v1/services`).
  3. Dịch vụ thu mua và trao đổi sách cũ (tiếp nhận yêu cầu và định giá trực tiếp).

## 2. Danh sách nghĩa vụ đăng ký/thông báo, công bố thông tin & quy trình tuân thủ

| Nhóm nghĩa vụ | Nội dung cần thực hiện / xác nhận (tham chiếu khung pháp lý TMĐT VN) | Trạng thái kỹ thuật hiện tại | Hành động bắt buộc trước Go-Live thương mại |
| --- | --- | --- | --- |
| **Đăng ký kinh doanh** | Đăng ký Hộ kinh doanh hoặc Doanh nghiệp với ngành nghề bán lẻ sách/TMĐT phù hợp. | Hồ sơ chuẩn bị | Xác nhận pháp nhân & mã ngành với đơn vị tư vấn pháp lý/Sở KH&ĐT hoặc UBND cấp có thẩm quyền. |
| **Thông báo website TMĐT bán hàng** | Thực hiện thủ tục thông báo website TMĐT bán hàng trên Cổng `online.gov.vn` (Bộ Công Thương) theo Nghị định 52/2013/NĐ-CP & Nghị định 85/2021/NĐ-CP khi vận hành thương mại. | Đã chuẩn bị đầy đủ bộ chính sách công khai & quy trình đặt hàng | Nộp hồ sơ thông báo trên `online.gov.vn` sau khi có pháp nhân/tên miền chính thức và gắn biểu tượng/liên kết xác nhận khi được duyệt. |
| **Công bố thông tin chủ sở hữu website** | Hiển thị công khai trên footer/trang thông tin: tên đơn vị, số GCN ĐKKD/MST, ngày/nơi cấp, địa chỉ trụ sở, điện thoại & email liên hệ. | Đã tạo trang `ecommerce-compliance.html` và cấu trúc footer | Điền thông tin pháp nhân thực tế ngay khi hoàn tất đăng ký kinh doanh. |
| **Công bố điều kiện giao dịch chung & chính sách** | Công khai điều khoản sử dụng, vận chuyển/giao nhận, đổi trả, hoàn tiền, thanh toán và bảo vệ người tiêu dùng trước khi khách đặt hàng. | Đã công khai `terms.html`, `shipping.html`, `returns.html`, `refund.html`, `consumer-tax.html` và hiển thị trước nút đăng ký & đặt hàng | Rà soát lần cuối với luật sư trước ngày mở bán. |
| **Bảo vệ thông tin cá nhân người tiêu dùng** | Công khai chính sách bảo mật, ghi nhận sự đồng ý (consent), cơ chế xem/sửa/xuất/xóa dữ liệu (DSAR) và bảo mật phiên/API. | Đã triển khai `privacy.html`, `/api/v1/privacy/*`, RBAC & IDOR protection | Xác nhận tuân thủ quy định bảo vệ dữ liệu cá nhân hiện hành tại thời điểm go-live. |
| **Thanh toán trực tuyến, thuế & hóa đơn** | Minh bạch giá VND, đối soát thanh toán an toàn (không lưu số thẻ), kê khai thuế và xuất hóa đơn điện tử theo quy định. | Đã triển khai server-side pricing, webhook signature/API key, `docs/consumer-tax-invoice-review.md` | Xác nhận chế độ thuế & hóa đơn điện tử với kế toán/cơ quan thuế. |

## 3. Đầu mối phụ trách & bảng theo dõi xác minh trước vận hành

| Vai trò phụ trách | Trách nhiệm chính | Đơn vị xác minh bên ngoài | Trạng thái |
| --- | --- | --- | --- |
| **Quản trị vận hành (`operations_admin_owner`)** | Cập nhật thông tin pháp nhân trên website, kiểm soát bảo mật hệ thống & audit log. | — | `pending_prelaunch_signoff` |
| **Phụ trách Pháp lý/Tuân thủ (`legal_compliance_owner`)** | Xác nhận nghĩa vụ TMĐT, nộp thông báo `online.gov.vn`, rà soát điều khoản & chính sách. | Luật sư / Bộ Công Thương | `pending_prelaunch_signoff` |
| **Phụ trách Kế toán/Thuế (`accounting_tax_owner`)** | Xác nhận ĐKKD, thuế GTGT/TNDN/TNCN, hóa đơn điện tử và lưu trữ chứng từ. | Đơn vị kế toán / Cơ quan thuế | `pending_prelaunch_signoff` |
| **Chăm sóc khách hàng (`customer_support_owner`)** | Tiếp nhận khiếu nại, đổi trả, hoàn tiền và yêu cầu quyền riêng tư đúng SLA. | — | `pending_prelaunch_signoff` |

## 4. Quy trình tuân thủ định kỳ & điểm công khai

1. **Trước khi mở bán chính thức:** hoàn tất xác minh của 4 đầu mối trên, điền thông tin pháp nhân thật vào `ecommerce-compliance.html` và footer, hoàn tất thông báo `online.gov.vn`.
2. **Khi thay đổi mô hình/tính năng:** nếu mở rộng sang mô hình sàn giao dịch cho bên thứ ba, tích hợp cổng thanh toán mới hoặc thay đổi điều khoản quan trọng, phải rà soát lại nghĩa vụ pháp lý và thông báo người dùng trước ít nhất **7 ngày**.
3. **Điểm công khai hiện có:**
   - Trang công khai: `ecommerce-compliance.html` (phiên bản `2026-01`).
   - API công khai: `GET /api/policies/ecommerce-compliance` và `GET /api/v1/policies/ecommerce-compliance` (`backend/ecommerce-compliance.js`).
   - Bộ chính sách liên kết: `terms.html`, `shipping.html`, `returns.html`, `refund.html`, `privacy.html`, `consumer-tax.html`.
