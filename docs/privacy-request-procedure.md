# Quy trình xử lý yêu cầu dữ liệu cá nhân (BN-194 / DSAR)

> **Lưu ý pháp lý:** Trước khi vận hành thương mại với người dùng thật, đơn vị vận hành cần rà soát quy trình, thời hạn và đầu mối chịu trách nhiệm với chuyên gia pháp lý hoặc cơ quan có thẩm quyền theo quy định áp dụng (ví dụ Nghị định bảo vệ dữ liệu cá nhân tại Việt Nam).

## 1. Kênh tiếp nhận & người chịu trách nhiệm

| Kênh tiếp nhận (`channel`) | Mô tả | Xác minh danh tính (`verificationMethod`) | Đầu mối tiếp nhận ban đầu |
| --- | --- | --- | --- |
| `web_portal` | Trang công khai `privacy.html` (yêu cầu đăng nhập) | `session_token` (tự động qua Bearer token hợp lệ) | Hàng đợi `GET /api/admin/privacy/data-requests` (Admin / Phụ trách dữ liệu) |
| `email_support` | Email đầu mối quyền riêng tư do đơn vị vận hành công bố | `manual_review` (đối chiếu email đăng ký + mã đơn gần nhất/xác nhận chủ sở hữu) | Hỗ trợ L1 → chuyển Phụ trách dữ liệu L2 |
| `in_person` | Yêu cầu trực tiếp bằng văn bản tại đơn vị vận hành | `manual_review` (đối chiếu giấy tờ tùy thân và tài khoản liên quan) | Phụ trách dữ liệu L2 |

### Phân quyền & cấp xử lý (`escalationLevel`)
- **`l1_support` (Tiếp nhận & sàng lọc):** kiểm tra đầy đủ thông tin, hướng dẫn tự phục vụ (cập nhật thông tin / xuất JSON) nếu áp dụng.
- **`l2_privacy_lead` (Phụ trách dữ liệu cá nhân / Admin có quyền `read:privacy`, `write:privacy`):** xác minh danh tính bổ sung, phân công (`assignedTo`), thực hiện truy cập/cập nhật/xuất/ẩn danh và ghi nhận mã kết quả (`resolutionCode`).
- **`l3_legal_admin` (Quản trị pháp lý / Ban điều hành):** xử lý khiếu nại, tranh chấp nghĩa vụ lưu trữ kế toán/thuế, yêu cầu quá hạn SLA hoặc yêu cầu từ cơ quan chức năng.

## 2. Phân loại, thời hạn nội bộ (SLA) & chuyển cấp

| Loại yêu cầu (`type`) | Thời hạn nội bộ (`dueAt`) | Ngưỡng cảnh báo / chuyển cấp | Quy trình thực thi được duyệt |
| --- | --- | --- | --- |
| `access` (Truy cập) | **48 giờ** | Quá 24 giờ chưa xử lý → chuyển `l2_privacy_lead`; quá hạn (`overdue: true`) → `l3_legal_admin` | Xác nhận phạm vi dữ liệu thuộc tài khoản và hướng dẫn/cung cấp thông tin qua kênh đã xác minh. |
| `update` (Cập nhật) | **48 giờ** | Như trên | Trường tự phục vụ: hướng dẫn dùng `PATCH /api/auth/customer-info`. Trường cần xác minh (email, học sinh/sinh viên): đối chiếu chứng từ rồi cập nhật và ghi nhận `fulfilled`. |
| `export` (Xuất dữ liệu) | **48 giờ** | Như trên | Hướng dẫn hoặc hỗ trợ xuất tệp JSON qua `POST /api/privacy/exports` (hết hạn sau 15 phút, yêu cầu xác thực lại). |
| `delete` (Xóa / ẩn danh) | **72 giờ** | Quá 36 giờ chưa xử lý → `l2_privacy_lead`; có nghĩa vụ lưu trữ kế toán/đơn hàng đang giao → `l3_legal_admin` | Kiểm tra đơn hàng đang xử lý/nghĩa vụ lưu trữ kế toán. Khi đủ điều kiện, Admin hoàn tất bằng `PATCH /api/admin/privacy/data-requests/:id` với `status: "completed"` và `executeAnonymization: true` (ẩn danh hồ sơ, vô hiệu hóa đăng nhập, thu hồi toàn bộ phiên; giữ hóa đơn/đơn hàng phục vụ đối soát). |

## 3. Vòng đời trạng thái & ghi nhận kết quả

- Trạng thái hợp lệ: `pending` → `processing` → `completed` | `rejected` (hoặc `pending` → `completed` | `rejected`). Trạng thái kết thúc (`completed`, `rejected`) không được mở lại.
- Chống trùng lặp: mỗi tài khoản chỉ có tối đa một yêu cầu đang mở (`pending` hoặc `processing`) cho mỗi loại (`409 Conflict`).
- Mã kết quả có cấu trúc (`resolutionCode`, không chứa dữ liệu cá nhân dạng văn bản tự do):
  - `fulfilled`: đã đáp ứng đầy đủ.
  - `partially_fulfilled`: đáp ứng một phần (ví dụ giữ lại chứng từ giao dịch theo nghĩa vụ lưu trữ).
  - `anonymized`: đã ẩn danh tài khoản và thu hồi toàn bộ phiên đăng nhập.
  - `rejected_unverified`: không thể xác minh danh tính chủ sở hữu.
  - `rejected_legal_retention`: không thể xóa do nghĩa vụ lưu trữ theo quy định.
  - `rejected_duplicate`: trùng yêu cầu đã xử lý.
  - `withdrawn`: người dùng rút yêu cầu.

## 4. Bảo vệ dữ liệu trong quá trình xử lý

- Không lưu nội dung nhạy cảm hay dữ liệu cá nhân dạng văn bản tự do (`details`) trong bản ghi yêu cầu hoặc trong nhật ký kiểm toán (`admin-audit.jsonl`).
- Nhật ký chỉ ghi mã yêu cầu, loại yêu cầu, trạng thái chuyển đổi, người phụ trách (`assignedTo`), cấp chuyển (`escalationLevel`) và mã kết quả (`resolutionCode`).
- Chỉ tài khoản có quyền `read:privacy` / `write:privacy` mới được xem và cập nhật hàng đợi quản trị.
- Khi ẩn danh tài khoản (`executeAnonymization: true`), toàn bộ phiên đăng nhập hiện có của người dùng bị hủy ngay lập tức.
