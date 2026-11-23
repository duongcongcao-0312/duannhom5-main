# Tổng hợp Tuân thủ Quyền riêng tư & Pháp lý — BookNest (`BN-12` / `BN-189`–`BN-202`)

> **Tuyên bố miễn trừ pháp lý**: Tài liệu và các kiểm thử kỹ thuật trong kho mã nguồn này phục vụ mục tiêu minh bạch vận hành, đối chiếu kỹ thuật và chuẩn bị hồ sơ tuân thủ; **không thay thế tư vấn pháp lý chính thức**. Mọi nghĩa vụ pháp lý cần được xác nhận bởi bộ phận pháp chế / chuyên gia hoặc cơ quan có thẩm quyền trước khi vận hành thương mại chính thức.

## 1. Bảng ánh xạ đầy đủ hạng mục `BN-189`–`BN-202`

| Hạng mục | Nội dung | Trang công khai / Tài liệu | API / Module thực thi | Kiểm thử tự động |
| --- | --- | --- | --- | --- |
| **BN-189** | Chính sách bảo mật dữ liệu cá nhân | `privacy.html` | `GET /api/v1/policies/privacy`, `backend/privacy-policy.js` | `tests/privacy-policy.test.js` |
| **BN-190** | Điều khoản sử dụng | `terms.html` | `GET /api/v1/policies/terms`, `backend/terms-policy.js` | `tests/terms-policy.test.js` |
| **BN-191** | Chính sách vận chuyển | `shipping.html` | `GET /api/v1/policies/shipping`, `backend/shipping-policy.js` | `tests/shipping-policy.test.js` |
| **BN-192** | Chính sách đổi trả | `returns.html` | `GET /api/v1/policies/return`, `backend/return-policy.js` | `tests/return-policy.test.js` |
| **BN-193** | Chính sách hoàn tiền | `refund.html` | `GET /api/v1/policies/refund`, `backend/refund-policy.js` | `tests/refund-policy.test.js` |
| **BN-194–197** | Tiếp nhận/xác minh DSAR, xuất, cập nhật, xóa/ẩn danh | `privacy.html`, `docs/` | `backend/routes/privacy.js`, `backend/privacy-data-requests.js`, `backend/privacy-export.js` | `tests/privacy-data-requests.test.js`, `tests/privacy-export.test.js`, `tests/data-deletion-anonymization.test.js` |
| **BN-198** | Quản lý consent (mục đích, phiên bản, rút lại) | `privacy.html`, `assets/privacy-consent.js` | `GET|POST|DELETE /api/v1/privacy/consents`, `backend/consent-policy.js` | `tests/consent-management.test.js` |
| **BN-199** | Lịch lưu giữ & xử lý hết hạn dữ liệu | `privacy.html`, `scripts/prune-privacy-consents.js` | `GET /api/v1/policies/retention`, `backend/data-retention-policy.js` | `tests/privacy-retention.test.js` |
| **BN-200** | Bản quyền bìa sách, hình ảnh & nội dung | `content-rights.html` | `GET /api/v1/policies/content-rights`, `backend/content-rights-policy.js` | `tests/content-rights-policy.test.js` |
| **BN-201** | Nghĩa vụ TMĐT tại Việt Nam | `ecommerce-compliance.html` | `GET /api/v1/policies/ecommerce-compliance`, `backend/ecommerce-compliance.js` | `tests/ecommerce-compliance.test.js` |
| **BN-202** | Bảo vệ người tiêu dùng, thuế & hóa đơn | `consumer-tax.html` | `GET /api/v1/policies/consumer-tax`, `backend/consumer-tax-policy.js` | `tests/consumer-tax-policy.test.js` |

## 2. Quy trình nội bộ & Nguyên tắc dữ liệu kiểm thử

- **Phân công nội bộ**:
  - **Quản trị viên (`admin`)**: phê duyệt/xử lý yêu cầu DSAR (`/api/v1/admin/privacy/data-requests`), giám sát audit log và lịch lưu giữ dữ liệu.
  - **Hỗ trợ khách hàng (`support`)**: tiếp nhận phản hồi ban đầu và hướng dẫn khách hàng gửi yêu cầu qua kênh chính thức.
  - **Pháp chế / Chủ sở hữu doanh nghiệp**: rà soát định kỳ phiên bản chính sách và xác nhận nghĩa vụ thông báo/đăng ký TMĐT, thuế, hóa đơn điện tử.
- **Không dùng dữ liệu cá nhân thật trong test/báo cáo công khai**: toàn bộ kiểm thử tự động trong `tests/*.test.js` chỉ sử dụng dữ liệu tổng hợp (`@example.com`, số điện thoại mẫu `0901...`).
