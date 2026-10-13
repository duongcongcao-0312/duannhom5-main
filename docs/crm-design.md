# Thiết kế lưu trữ thông tin khách hàng (CRM)

Tài liệu này định nghĩa mô hình dữ liệu CRM cho BookNest. Phiên bản hiện tại
của ứng dụng đang lưu người dùng trong `data/users.json` và đơn hàng trong
`data/orders.jsonl`; thiết kế dưới đây là hợp đồng dữ liệu để có thể migrate
sang cơ sở dữ liệu quan hệ mà không thay đổi luồng giao diện.

## Phạm vi và nguyên tắc

### Trạng thái triển khai

Luồng hiện tại đã hỗ trợ lưu hồ sơ liên hệ xuyên thiết bị qua tài khoản:
`GET /api/auth/me` trả về `customerInfo` và
`PATCH /api/auth/customer-info` cập nhật các trường `customerName`, `name`,
`phone`, `address`. Giao diện vẫn giữ bản sao cục bộ để hỗ trợ khách chưa đăng
nhập hoặc khi máy chủ tạm thời không kết nối. Các bảng CRM bên dưới là schema
đích cho bước tách dữ liệu hồ sơ khỏi `users.json`.

- Một khách hàng được định danh bằng `customer.id`, không dùng email hoặc số
  điện thoại làm khóa chính.
- Một tài khoản đăng nhập có tối đa một hồ sơ khách hàng; tài khoản khách chưa
  đăng nhập có thể được tạo hồ sơ tạm bằng email hoặc số điện thoại đã xác
  thực.
- Thông tin giao hàng được chụp lại trên đơn hàng để lịch sử không thay đổi
  khi khách cập nhật địa chỉ.
- Không lưu mật khẩu, token phiên hoặc dữ liệu thanh toán thẻ trong CRM.
- Chỉ thu thập trường cần cho đặt hàng, chăm sóc khách hàng và nghĩa vụ pháp
  lý; mọi trường tùy chọn phải có giá trị `NULL`.

## Mô hình quan hệ

```text
users 1──1 customers
customers 1──N customer_addresses
customers 1──N orders
orders 1──N order_items
customers 1──N service_requests
customers 1──N consent_records
```

### `users`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh tài khoản |
| `email` | VARCHAR(254) | UNIQUE, NOT NULL | Email chuẩn hóa chữ thường |
| `password_hash` | TEXT | NOT NULL | Hash scrypt/Argon2; không lưu mật khẩu gốc |
| `role` | VARCHAR(20) | NOT NULL, `user`/`admin` | Quyền hệ thống |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm tạo |
| `updated_at` | TIMESTAMP | NOT NULL | Lần cập nhật cuối |
| `last_login_at` | TIMESTAMP | NULL | Lần đăng nhập gần nhất |

Index: unique `lower(email)`, `role`.

### `customers`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh hồ sơ CRM |
| `user_id` | UUID | FK `users.id`, UNIQUE, NULL | Liên kết tài khoản đăng nhập |
| `full_name` | VARCHAR(120) | NOT NULL | Họ tên khách hàng |
| `phone` | VARCHAR(20) | NOT NULL | Số điện thoại đã chuẩn hóa |
| `email` | VARCHAR(254) | NULL | Email liên hệ của khách |
| `student_type` | VARCHAR(20) | NOT NULL, mặc định `other` | `student`, `university`, `other` |
| `student_id` | VARCHAR(80) | NULL | Mã học sinh/sinh viên; chỉ lưu khi có đồng ý |
| `notes` | TEXT | NULL | Ghi chú chăm sóc, không lưu dữ liệu nhạy cảm |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm tạo hồ sơ |
| `updated_at` | TIMESTAMP | NOT NULL | Lần cập nhật cuối |

Index: `user_id`, `phone`, `lower(email)`, `updated_at`.

### `customer_addresses`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh địa chỉ |
| `customer_id` | UUID | FK `customers.id`, NOT NULL | Chủ sở hữu |
| `label` | VARCHAR(40) | NOT NULL | Ví dụ `Nhà`, `Cơ quan` |
| `recipient_name` | VARCHAR(120) | NOT NULL | Người nhận |
| `phone` | VARCHAR(20) | NOT NULL | Số điện thoại nhận |
| `address_line` | VARCHAR(300) | NOT NULL | Địa chỉ đầy đủ |
| `is_default` | BOOLEAN | NOT NULL, mặc định `false` | Địa chỉ mặc định |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm tạo |
| `updated_at` | TIMESTAMP | NOT NULL | Lần cập nhật cuối |

Mỗi khách hàng chỉ có một địa chỉ `is_default = true` (partial unique index).

### `orders`

Đơn hàng phải giữ bản chụp thông tin giao nhận:

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Mã đơn nội bộ |
| `customer_id` | UUID | FK `customers.id`, NULL | Khách đặt đơn, nếu đã đăng nhập |
| `order_code` | VARCHAR(40) | UNIQUE, NOT NULL | Mã tra cứu công khai |
| `recipient_name` | VARCHAR(120) | NOT NULL | Bản chụp tên người nhận |
| `recipient_phone` | VARCHAR(20) | NOT NULL | Bản chụp số điện thoại |
| `shipping_address` | VARCHAR(300) | NOT NULL | Bản chụp địa chỉ |
| `status` | VARCHAR(20) | NOT NULL | `received`, `processing`, `shipping`, `completed`, `cancelled` |
| `payment_method` | VARCHAR(20) | NOT NULL | `cod` hoặc `transfer` |
| `payment_status` | VARCHAR(20) | NOT NULL | Trạng thái thanh toán |
| `subtotal` | INTEGER | NOT NULL, >= 0 | Tổng trước giảm giá, đơn vị VND |
| `discount` | INTEGER | NOT NULL, >= 0 | Số tiền giảm |
| `total` | INTEGER | NOT NULL, >= 0 | Tổng phải trả |
| `coupon_code` | VARCHAR(40) | NULL | Mã giảm giá, nếu có |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm đặt |
| `updated_at` | TIMESTAMP | NOT NULL | Lần cập nhật cuối |

Index: `customer_id, created_at DESC`, unique `order_code`, `status`.

### `order_items`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh dòng hàng |
| `order_id` | UUID | FK `orders.id` ON DELETE CASCADE | Đơn hàng |
| `book_id` | VARCHAR(120) | NULL | ID sách tại thời điểm đặt |
| `title_snapshot` | VARCHAR(200) | NOT NULL | Tên sách tại thời điểm đặt |
| `unit_price` | INTEGER | NOT NULL, >= 0 | Giá tại thời điểm đặt |
| `quantity` | INTEGER | NOT NULL, > 0 | Số lượng |
| `line_total` | INTEGER | NOT NULL, >= 0 | Thành tiền |

Unique `(order_id, title_snapshot)` và index `order_id`.

### `service_requests`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh yêu cầu |
| `customer_id` | UUID | FK `customers.id`, NULL | Hồ sơ liên quan |
| `service` | VARCHAR(20) | NOT NULL | `rent`, `sell`, `exchange` |
| `book_title` | VARCHAR(200) | NOT NULL | Tên sách khách gửi |
| `condition` | VARCHAR(20) | NOT NULL | Tình trạng sách |
| `contact_name` | VARCHAR(120) | NOT NULL | Tên liên hệ |
| `contact_phone` | VARCHAR(20) | NOT NULL | Số điện thoại |
| `note` | TEXT | NULL | Ghi chú |
| `status` | VARCHAR(20) | NOT NULL | `pending`, `processing`, `completed`, `cancelled` |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm gửi |
| `updated_at` | TIMESTAMP | NOT NULL | Lần cập nhật cuối |

Index: `customer_id, created_at DESC`, `status`.

### `consent_records`

| Trường | Kiểu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | UUID | PK | Định danh bản ghi |
| `customer_id` | UUID | FK `customers.id`, NOT NULL | Khách hàng |
| `purpose` | VARCHAR(40) | NOT NULL | `order`, `service`, `marketing` |
| `granted` | BOOLEAN | NOT NULL | Khách đã đồng ý hay chưa |
| `policy_version` | VARCHAR(20) | NOT NULL | Phiên bản chính sách |
| `source` | VARCHAR(20) | NOT NULL | `web`, `admin`, `api` |
| `created_at` | TIMESTAMP | NOT NULL | Thời điểm ghi nhận |
| `revoked_at` | TIMESTAMP | NULL | Thời điểm rút lại đồng ý |

Index: `customer_id, purpose, created_at DESC`.

## Quyền truy cập và bảo mật

| Vai trò | Được xem | Được sửa |
| --- | --- | --- |
| Khách chưa đăng nhập | Dữ liệu trong phiên hiện tại | Dữ liệu tạm trong phiên |
| Khách đã đăng nhập | Hồ sơ, địa chỉ và đơn của chính mình | Hồ sơ và địa chỉ của chính mình |
| Nhân viên CSKH | Hồ sơ, đơn và yêu cầu được phân công | Trạng thái yêu cầu, ghi chú nghiệp vụ |
| Admin | Toàn bộ CRM và audit log | Toàn bộ dữ liệu nghiệp vụ |

- Mọi endpoint CRM phải xác thực Bearer token; kiểm tra quyền sở hữu ở tầng
  service, không chỉ dựa vào ID từ request.
- Admin/CSKH phải ghi audit log cho thao tác xem hàng loạt, sửa, xóa và xuất
  dữ liệu.
- TLS bắt buộc khi triển khai thật; secret và khóa mã hóa đặt trong biến môi
  trường, không commit vào repository.
- Mật khẩu tiếp tục dùng hash một chiều; token phiên không lưu trong CRM.
- `phone`, `student_id`, ghi chú và dữ liệu xuất CRM phải được mã hóa ở tầng
  lưu trữ khi chuyển sang database hỗ trợ encryption-at-rest. Không ghi các
  trường này vào log.
- Giới hạn tốc độ đăng nhập và endpoint dữ liệu cá nhân; validate độ dài,
  định dạng và chống injection ở server.
- Thực hiện xóa/anonymize theo yêu cầu khách hàng, nhưng giữ bản chụp tối
  thiểu của đơn hàng khi pháp luật/kế toán yêu cầu.

## API dự kiến

| Phương thức | Đường dẫn | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/me/customer` | Người dùng | Lấy hồ sơ và địa chỉ của chính mình |
| `PATCH` | `/api/me/customer` | Người dùng | Cập nhật thông tin liên hệ |
| `GET` | `/api/me/orders` | Người dùng | Danh sách đơn của chính mình |
| `GET` | `/api/me/service-requests` | Người dùng | Yêu cầu dịch vụ của chính mình |
| `GET` | `/api/admin/customers` | Admin/CSKH | Tìm kiếm, phân trang CRM |
| `GET` | `/api/admin/customers/:id` | Admin/CSKH | Xem hồ sơ chi tiết |
| `PATCH` | `/api/admin/customers/:id` | Admin/CSKH | Sửa ghi chú/trạng thái nghiệp vụ |
| `POST` | `/api/admin/customers/:id/anonymize` | Admin | Ẩn danh dữ liệu theo chính sách |

Response không trả về `password_hash`, token, dữ liệu thanh toán hoặc trường
không thuộc quyền của caller.

## Lộ trình triển khai

- [ ] **Schema:** chọn PostgreSQL hoặc SQLite, tạo migration cho các bảng trên,
  khóa ngoại, check constraint và index.
- [ ] **Migration:** viết importer từ `users.json`, `orders.jsonl`,
  `service-requests.jsonl`; chạy idempotent và tạo báo cáo bản ghi lỗi.
- [ ] **Customer API:** thêm API hồ sơ, địa chỉ, lịch sử đơn và yêu cầu dịch vụ.
- [ ] **Auth:** dùng `user_id` để kiểm tra quyền sở hữu; thêm role CSKH và
  session/token rotation.
- [ ] **Validation:** dùng schema validator ở server, chuẩn hóa email/phone,
  giới hạn payload và test dữ liệu xấu.
- [ ] **Encryption:** cấu hình TLS, encryption-at-rest/field encryption,
  quản lý key qua secret manager và masking log.
- [ ] **Privacy:** thêm consent, chính sách lưu giữ, export/anonymize và audit log.
- [ ] **Frontend:** thay localStorage hồ sơ bằng API; chỉ dùng cache cục bộ
  không nhạy cảm và xóa cache khi người dùng yêu cầu.
- [ ] **Tests:** unit test repository/validation, integration test phân quyền,
  migration test, kiểm tra không rò rỉ trường nhạy cảm và E2E đăng nhập khác
  thiết bị.
- [ ] **Docs/operations:** cập nhật README, migration runbook, backup/restore,
  retention và quy trình xử lý yêu cầu xóa dữ liệu.

## Mapping với phiên bản hiện tại

Trong giai đoạn chuyển tiếp, `users.json` có thể chứa `customerInfo` gồm
`customerName`, `name`, `phone`, `address`. Đây là dạng tạm thời tương đương
với `customers` và `customer_addresses`; không nên mở rộng JSON này thành
nguồn dữ liệu CRM lâu dài vì thiếu khóa ngoại, phân quyền theo bản ghi và audit
log.
