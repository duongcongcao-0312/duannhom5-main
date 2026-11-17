# Thiết kế CRM BookNest

Tài liệu này ghi nhận ranh giới giữa CRM đang chạy và các hạng mục có thể phát
triển tiếp. Đây không phải mô tả một schema tương lai đã được triển khai.
Hướng dẫn route, quyền, migration và ví dụ request/response hiện hành nằm tại
[customer-crm.md](./customer-crm.md); API chuẩn được mô tả trong
[openapi.json](./openapi.json).

## Mô hình hiện tại

- Hồ sơ CRM có các trường tên, email, điện thoại, trạng thái và thông tin audit.
- API CRM yêu cầu phiên đăng nhập và kiểm tra quyền ở backend. Có các endpoint
  tương thích dưới `/api/admin/customers`; xem tài liệu CRM để biết quyền cụ
  thể.
- Lịch sử tương tác được lưu riêng, gắn với khách hàng và có audit người tạo/
  cập nhật.
- Thông tin liên hệ của tài khoản (`customerInfo`) thuộc hồ sơ người dùng; đơn
  hàng và yêu cầu dịch vụ có dữ liệu liên hệ riêng, không đồng nghĩa với quan
  hệ hồ sơ CRM được tự động liên kết.
- Runtime dùng file JSON/JSONL khi không có `DATABASE_URL`; khi có URL thì dùng
  PostgreSQL. Migration có thể nhập các collection JSONB cũ sang bảng quan hệ,
  nhưng không nhập các file JSON/JSONL trên đĩa.
- Consent là một API riêng gắn với tài khoản đã đăng nhập. Giao diện hiện chưa
  tự động ghi consent trong form đơn hàng/dịch vụ và trường `retentionDays`
  chưa điều khiển việc xóa dữ liệu.

## Ranh giới dữ liệu và quyền riêng tư

Chỉ lưu trường cần cho nghiệp vụ CRM; không lưu mật khẩu gốc, bearer token hay
thông tin thẻ. Quyền xem/tạo/sửa/xóa hồ sơ và tương tác được kiểm tra ở
backend theo vai trò/permission; không tin role do trình duyệt gửi.

Không coi bản ghi consent, `retentionDays`, soft-delete hoặc audit log là cơ
chế tự động xóa/ẩn danh dữ liệu. Trước khi dùng dữ liệu thật, cần xác định
thời hạn lưu giữ, kênh yêu cầu quyền riêng tư và quy trình xóa/ẩn danh, rồi
triển khai và kiểm thử các quy trình đó.

## Hạng mục có thể cân nhắc

Các ý tưởng dưới đây chưa phải tính năng hiện tại; cần issue riêng, thiết kế
và migration trước khi thực hiện:

- Tách địa chỉ giao hàng thành tài nguyên riêng, trong khi vẫn giữ snapshot
  trên đơn cũ.
- Xây dựng quy trình liên kết hồ sơ CRM với tài khoản/đơn/yêu cầu dịch vụ, với
  quy tắc xác minh danh tính và chống gộp nhầm.
- Tích hợp UI thu thập consent vào các luồng phù hợp và xác định tác động khi
  người dùng từ chối/rút lại.
- Thực thi retention, export hoặc xóa/ẩn danh với audit và ngoại lệ nghiệp vụ
  đã được phê duyệt.

Mọi thay đổi schema cần migration có thứ tự, backup đã xác minh, kiểm thử
rollback/khả năng tương thích và cập nhật đồng bộ `docs/customer-crm.md`,
`docs/openapi.json` cùng runbook liên quan.
