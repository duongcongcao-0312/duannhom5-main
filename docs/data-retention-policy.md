# Chính sách & Lịch thời hạn lưu trữ dữ liệu (`BN-199` / Issue #176)

Tài liệu quy định thời hạn lưu giữ, lịch xóa/ẩn danh, cơ chế ngoại lệ pháp lý (legal hold) và phân định rõ 4 nhóm dữ liệu của BookNest: **vận hành (`operational`)**, **giao dịch (`transactional`)**, **nhật ký (`logs`)** và **bản sao lưu (`backups`)**.

## 1. Bảng danh mục loại dữ liệu, mục đích, thời hạn & căn cứ lưu giữ

| Mã nhóm | Phân loại | Loại dữ liệu | Mục đích xử lý | Thời hạn lưu giữ | Căn cứ lưu giữ | Hành động hết hạn |
| --- | --- | --- | --- | --- | --- | --- |
| `sessions_and_reset_tokens` | `operational` | Phiên đăng nhập & token khôi phục mật khẩu | Xác thực phiên & khôi phục tài khoản | Phiên `8 giờ` (refresh tối đa `30 ngày`); reset token `1 giờ` | Bảo mật xác thực | Xóa tự động (`delete`) |
| `privacy_exports` | `operational` | Bản xuất dữ liệu cá nhân (JSON) | Trả bản sao dữ liệu cho chủ thể dữ liệu | `15 phút` | Tối thiểu hóa dữ liệu | Xóa tự động (`delete`) |
| `consent_records` | `operational` | Bản ghi đồng ý (Consent) | Bằng chứng đồng ý / rút lại đồng ý | Theo `retentionDays` (mặc định ≤ `365 ngày`; `0` = không tự hết hạn) | Nghĩa vụ chứng minh sự đồng ý | Xóa định kỳ qua script (`delete`) |
| `account_profiles_and_addresses` | `operational` | Tài khoản, hồ sơ & địa chỉ giao hàng | Quản lý tài khoản, ưu đãi SV & giao hàng | Khi tài khoản hoạt động hoặc tối đa `3 năm` không hoạt động; `72 giờ` theo DSAR xóa | Thực hiện hợp đồng & quyền chủ thể dữ liệu | Ẩn danh (`anonymize`) |
| `service_requests_and_crm` | `operational` | Yêu cầu dịch vụ sách & hồ sơ CSKH (CRM) | Hỗ trợ thuê/thu mua/trao đổi & giải quyết khiếu nại | Tối đa `3 năm` kể từ tương tác gần nhất | Chăm sóc khách hàng & giải quyết tranh chấp | Ẩn danh (`anonymize`) |
| `orders_and_payments` | `transactional` | Đơn hàng, mã đối soát `BN...`, thanh toán & hoàn tiền | Xử lý đơn, đối soát SePay/COD & sổ sách kế toán | `5–10 năm` (xác nhận với kế toán theo loại chứng từ) | Nghĩa vụ pháp lý về kế toán & thuế | Tách định danh / ẩn danh sau hết hạn (`anonymize`) |
| `admin_audit_logs` | `logs` | Nhật ký kiểm toán (`admin-audit.jsonl`) | Giám sát an ninh, truy vết thay đổi nhạy cảm | `365 ngày` (`AUDIT_POLICY`) | An ninh hệ thống & quản trị rủi ro | Xoay vòng & xóa (`delete`) |
| `encrypted_backups` | `backups` | Bản sao lưu mã hóa AES-256-GCM | Khôi phục sau sự cố (DR) | `30 ngày` xoay vòng tự động | Đảm bảo tính sẵn sàng dịch vụ | Xóa bản sao lưu cũ (`delete`) |

## 2. Lịch xóa / ẩn danh & ghi nhận kết quả xử lý

1. **Tự động theo thời gian thực (TTL):** Phiên đăng nhập (`backend/auth.js`), token đặt lại mật khẩu và payload xuất dữ liệu cá nhân (`backend/privacy-export.js`) tự hết hạn và bị loại bỏ ngay khi quá TTL.
2. **Định kỳ bằng công cụ vận hành (`npm run privacy:retention`):**
   - Chạy `node scripts/prune-privacy-consents.js` ở chế độ mặc định `dry-run` để kiểm kê số bản ghi đủ điều kiện (`eligible`).
   - Khi được phê duyệt, chạy với cờ `--apply` để thực thi xóa các bản ghi consent hết hạn (`retentionDays > 0`) và lưu đầu ra JSON (`{ mode, asOf, eligible, pruned }`) vào nhật ký vận hành.
3. **Theo yêu cầu chủ thể dữ liệu (DSAR `delete`):** Quản trị viên xử lý trong SLA `72 giờ` qua `PATCH /api/v1/admin/privacy/data-requests/:id` (`executeAnonymization: true`), ẩn danh trường định danh, khóa đăng nhập, thu hồi toàn bộ phiên và ghi nhận kết quả vào audit log.
4. **Xoay vòng log & bản sao lưu:** Audit log tuân thủ `AUDIT_POLICY` (`365 ngày`, bất biến append-only). Bản sao lưu mã hóa xoay vòng `30 ngày`; nếu cần khôi phục bản sao lưu cũ, bắt buộc áp dụng lại danh sách ẩn danh DSAR để không làm "hồi sinh" dữ liệu đã xóa.

## 3. Cơ chế ngoại lệ khi có nghĩa vụ lưu giữ hợp lệ (Legal Hold)

Khi phát sinh một trong các căn cứ sau, dữ liệu được gắn trạng thái ngoại lệ (`legal_hold`) và **tạm hoãn xóa** cho đến khi nghĩa vụ kết thúc:
- **Nghĩa vụ kế toán / thuế (`accounting_tax_obligation`):** Dữ liệu đơn hàng, đối soát thanh toán và hoàn tiền trong thời hạn lưu giữ chứng từ luật định.
- **Tranh chấp / khiếu nại đang xử lý (`active_dispute_or_complaint`):** Hồ sơ đơn hàng, CRM hoặc dịch vụ đang trong quá trình giải quyết tranh chấp hoặc có yêu cầu từ cơ quan có thẩm quyền.
- **Bằng chứng consent (`consent_evidence_non_expiring`):** Bản ghi consent có `retentionDays = 0`.
- **Điều tra sự cố an ninh (`security_incident_investigation`):** Audit log và bản sao lưu liên quan đến sự cố bảo mật đang điều tra.

## 4. Điểm công khai & kiểm chứng

- Công khai tóm tắt lịch lưu trữ trong `privacy.html#dataRetentionSchedule`.
- API công khai: `GET /api/policies/retention` và `GET /api/v1/policies/retention` (`backend/data-retention-policy.js`).
- Kiểm thử tự động: `tests/privacy-retention.test.js`.
