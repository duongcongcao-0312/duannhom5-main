# Quy trình xóa hoặc ẩn danh dữ liệu cá nhân có kiểm soát (`BN-197` / Issue #174)

> **Lưu ý:** Tài liệu này quy định quy trình kỹ thuật và vận hành xóa/ẩn danh dữ liệu cá nhân của BookNest; đơn vị vận hành cần xác nhận nghĩa vụ pháp lý cụ thể với cơ quan nhà nước hoặc chuyên gia pháp lý có thẩm quyền trước khi áp dụng thương mại chính thức.

## 1. Phạm vi xử lý, xác minh danh tính & ngoại lệ lưu giữ

| Nhóm dữ liệu | Hành động khi hoàn tất DSAR `delete` | Cơ sở & ghi chú |
| --- | --- | --- |
| **Tài khoản & hồ sơ (`users`)** | Ẩn danh (`name` → `Tài khoản đã ẩn danh`, `email` → `deleted-<id>@anonymized.local`, xóa `customerInfo`, `studentId`, `socialAccounts`, `passwordReset`, vô hiệu hóa `isActive = false` & `passwordAuthEnabled = false`) | Ngăn đăng nhập lại và loại bỏ định danh cá nhân |
| **Phiên đăng nhập (`sessionStore`)** | Thu hồi ngay toàn bộ phiên hoạt động (`destroyUserSessions`) | Ngăn tiếp tục truy cập bằng token cũ |
| **Sổ địa chỉ giao hàng (`addressStore`)** | Xóa sạch toàn bộ bản ghi địa chỉ của tài khoản (`deleteByUser`) | Không giữ lại địa chỉ/SĐT ngoài mục đích |
| **Bản xuất dữ liệu cá nhân (`privacyExportStore`)** | Hủy payload và xóa mọi bản sao đang tồn tại (`purgeUserExports`) | Bao gồm cả bản sao tạm thời liên quan |
| **Đơn hàng & chứng từ thanh toán (`orders`)** | **Lưu giữ theo nghĩa vụ hợp lệ** (giữ nguyên sổ sách kế toán/thuế, không xóa trực tiếp) | Phục vụ đối soát tài chính, thuế và giải quyết tranh chấp |
| **Bản sao lưu mã hóa (`backups`)** | Xoay vòng tự động 30 ngày; khi khôi phục (DR) bắt buộc áp dụng lại danh sách ẩn danh DSAR | Ngăn khôi phục ngược dữ liệu đã xóa |

- **Xác minh danh tính:** Yêu cầu trực tuyến (`POST /api/v1/privacy/data-requests` với `type: "delete"`) xác minh qua Bearer session của chính chủ tài khoản; yêu cầu qua email/trực tiếp do phụ trách dữ liệu đối chiếu chủ tài khoản trước khi thực thi. Xóa trực tiếp qua `DELETE /api/v1/users/:id` luôn bị chặn (`403 GOVERNED_DELETION_REQUIRED`).

## 2. Quy trình thực hiện có kiểm soát & đầu mối phụ trách

1. **Tiếp nhận & kiểm tra ngoại lệ (`support` — L1 / `privacy_lead` — L2):**
   - Kiểm tra xem tài khoản có đơn hàng đang giao, tranh chấp/khiếu nại mở hoặc yêu cầu legal hold hay không.
2. **Phê duyệt & thực thi ẩn danh (`admin` có quyền `write:privacy` — L3, SLA `72 giờ`):**
   - Chuyển trạng thái qua `PATCH /api/v1/admin/privacy/data-requests/:id` với `{ status: "completed", executeAnonymization: true }`.
   - Hệ thống tự động thực hiện đồng bộ: (1) ẩn danh tài khoản, (2) thu hồi toàn bộ phiên, (3) xóa toàn bộ địa chỉ đã lưu, (4) hủy toàn bộ bản xuất dữ liệu cá nhân đang tồn tại.
3. **Lưu vết xử lý tối thiểu (Minimal Audit Trail):**
   - Ghi 1 bản ghi `privacy.account.anonymize` vào `admin-audit.jsonl` chỉ chứa metadata tối thiểu (`addressesDeleted`, `exportsPurged`, `sessionsRevoked: true`, `ordersPreservedForAccounting: true`), **tuyệt đối không lưu tên, email, SĐT hay địa chỉ đã xóa**.

## 3. Hướng dẫn công khai cho người dùng & kiểm chứng

- Hướng dẫn công khai: `privacy.html#dataDeletionGuide`.
- Kiểm thử tự động đầu-cuối: `tests/data-deletion-anonymization.test.js`.
