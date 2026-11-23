# Quy trình quản lý sự đồng ý (Consent Management — `BN-198` / Issue #175)

> **Lưu ý:** Tài liệu này mô tả thiết kế kỹ thuật và quy trình vận hành quản lý sự đồng ý của BookNest, **không thay thế ý kiến tư vấn pháp lý có thẩm quyền**.

## 1. Xác định trường hợp, mục đích & loại dữ liệu cần đồng ý

| Mục đích (`purpose`) | Bắt buộc để mua hàng/đăng ký? | Mặc định | Loại dữ liệu liên quan | Căn cứ & nguyên tắc |
| --- | --- | --- | --- | --- |
| `order` | Không gộp cứng vào điều khoản tiếp thị; xử lý theo giao dịch đặt hàng | Không tích sẵn | Họ tên người nhận, SĐT, địa chỉ, danh sách sách | Cho phép ghi nhận/rút lại trên tài khoản; đơn đã phát sinh vẫn đối soát theo nghĩa vụ giao dịch/kế toán. |
| `service` | Không bắt buộc cho tài khoản chung | Không tích sẵn | Họ tên, SĐT, tên sách, tình trạng sách, ghi chú | Chỉ áp dụng khi khách gửi yêu cầu thuê, thu mua hoặc trao đổi sách. |
| `marketing` | **Không bao giờ bắt buộc** (tùy chọn hoàn toàn) | **Không tích sẵn (`false`)** | Email, họ tên | Chỉ xử lý khi người dùng chủ động đồng ý (opt-in); từ chối hoặc rút lại không ảnh hưởng đăng ký tài khoản hay đặt hàng. |

## 2. Cơ chế xin, ghi nhận, rút lại & quản lý phiên bản đồng ý

- **Xin đồng ý tách bạch (Unbundled Opt-in):** Trang `privacy.html#consentManagement` cung cấp từng ô chọn độc lập theo từng mục đích (`order`, `service`, `marketing`), mặc định không tích sẵn và có nút **Lưu lựa chọn** / **Rút lại** riêng. Biểu mẫu đăng ký và thanh toán (`index.html`) không gộp đồng ý tiếp thị vào điều kiện sử dụng.
- **Ghi nhận bằng chứng đầy đủ (`POST /api/v1/privacy/consents`):** Mỗi thao tác tạo bản ghi mới (append-only) gồm: `id`, `subjectId` (lấy từ session, cấm giả mạo), `purpose`, `consent` (`true`/`false`), `policyVersion` (`2026-01`), `dataSource` (`web`/`admin`/`api`), `retentionDays` và thời điểm `createdAt` (ISO-8601).
- **Rút lại đồng ý dễ dàng (`DELETE /api/v1/privacy/consents/:purpose?policyVersion=2026-01`):** Người dùng có thể rút lại bất kỳ lúc nào trong 1 thao tác; hệ thống ghi nhận bản ghi thu hồi mới (giữ nguyên lịch sử bằng chứng trước đó) và cập nhật trạng thái hiện hành (`current[purpose].consent = false`).
- **Quản lý phiên bản nội dung đồng ý:** Khi cập nhật nội dung chính sách quan trọng, tăng `policyVersion` (thông báo trước ít nhất `7 ngày`) và yêu cầu xác nhận lại đối với các mục đích tùy chọn bị ảnh hưởng; các bản ghi cũ vẫn giữ nguyên mã phiên bản đã đồng ý tại thời điểm xác nhận.

## 3. Điểm công khai & kiểm thử

- Trang công khai & điều khiển tự phục vụ: `privacy.html#consentManagement`.
- API chính sách công khai: `GET /api/policies/consent` và `GET /api/v1/policies/consent` (`backend/consent-policy.js`).
- Kiểm thử tự động: `tests/consent-management.test.js`.
