# Quy trình quản lý, đồng bộ & rà soát Chính sách quyền riêng tư (BN-189)

> **Lưu ý pháp lý:** Trước khi vận hành thương mại với người dùng thật, đơn vị vận hành cần rà soát và xác nhận nội dung Chính sách quyền riêng tư, thông tin pháp nhân, đầu mối bảo vệ dữ liệu cá nhân (DPO) và thời hạn lưu trữ với chuyên gia pháp lý hoặc cơ quan có thẩm quyền; tài liệu này không thay thế tư vấn pháp lý.

## 1. Điểm công khai & nguồn đồng bộ
- **Trang công khai:** `privacy.html` (phiên bản `2026-01`, hiệu lực `01/01/2026`) và API `GET /api/policies/privacy` (`backend/privacy-policy.js`).
- **Điểm hiển thị trước giao dịch:** liên kết `privacy.html` xuất hiện trước nút **"Tạo tài khoản"** (`#registerPolicyNotice` trong `index.html`), trong footer của `index.html` và `book.html`, cũng như liên kết chéo trên cả 5 trang pháp lý (`privacy.html`, `terms.html`, `shipping.html`, `returns.html`, `refund.html`).
- **Đồng bộ kỹ thuật với website & backend:**
  - Bộ nhớ trình duyệt (`localStorage`, `sessionStorage`), không đặt cookie quảng cáo hoặc gắn analytics bên thứ ba.
  - Dịch vụ bên thứ ba thực tế: Firebase Authentication (tùy chọn), VietQR, SePay webhook (tùy chọn), hạ tầng hosting/PostgreSQL/SMTP/vận chuyển.
  - Mã phiên bản chính sách (`2026-01`) đồng bộ giữa `backend/privacy-policy.js`, `privacy.html` và `assets/privacy-consent.js` (`POLICY_VERSION`).

## 2. Quy trình rà soát & cập nhật định kỳ
1. **Kiểm kê khi thay đổi tính năng:** trước khi thêm trường dữ liệu người dùng mới, cookie/analytics, công cụ tiếp thị hoặc nhà cung cấp bên thứ ba mới, kỹ sư và phụ trách dữ liệu phải cập nhật đồng bộ `backend/privacy-policy.js` và `privacy.html`.
2. **Cập nhật phiên bản & ngày hiệu lực:** khi có thay đổi quan trọng về phạm vi thu thập, bên nhận hoặc thời hạn lưu trữ, tăng mã phiên bản (`version`), cập nhật `effectiveDate`, đồng bộ `POLICY_VERSION` trong `assets/privacy-consent.js` và công bố trên `privacy.html` trước ít nhất **7 ngày**.
3. **Thực thi quyền chủ thể dữ liệu & dọn dẹp theo thời hạn:**
   - Tiếp nhận và xử lý yêu cầu (`access`/`update`/`export` trong **48 giờ**, `delete` trong **72 giờ**) theo `docs/privacy-request-procedure.md`.
   - Rà soát và chạy định kỳ công cụ dọn dẹp consent hết hạn (`npm run privacy:retention`, mặc định chế độ xem trước `--dry-run`) cho các bản ghi có `retentionDays > 0`.
   - Chạy kiểm thử tự động `tests/privacy-policy.test.js`, `tests/privacy-data-requests.test.js`, `tests/privacy-export.test.js` và `tests/privacy-retention.test.js` trước khi phát hành.
