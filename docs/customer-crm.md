# Hướng dẫn CRM khách hàng

Tài liệu này mô tả API CRM đang chạy, schema PostgreSQL đích và cách nạp dữ
liệu mẫu. **Backend hiện tại vẫn đọc/ghi JSON** (`data/customers.json`); các
file SQL là migration/schema đích độc lập, chưa được `server.js` sử dụng.
Chạy migration không tự chuyển API sang PostgreSQL.

## Quyền truy cập

API CRM yêu cầu `Authorization: Bearer <token>` lấy từ `POST /api/auth/login`.
Token chứa vai trò từ tài khoản đã xác thực; không truyền vai trò trong payload.

| Vai trò | Xem | Tạo | Cập nhật | Xoá mềm |
| --- | --- | --- | --- | --- |
| `admin` | Có | Có | Có | Có |
| `sales` | Có | Có | Có | Không |
| `support` | Có | Không | Không | Không |
| `user` / chưa đăng nhập | Không | Không | Không | Không |

## API đang triển khai

Mọi phản hồi đều là JSON. Các ví dụ dùng `http://127.0.0.1:8000`; thay
`<token>` và `<customer-id>` bằng giá trị thực. Hồ sơ runtime có các trường
`id`, `name`, `email`, `phone`, `status`, `created_by`, `updated_by` và thời
gian tạo/cập nhật. `address`, `gender`, ngày sinh, đồng ý xử lý dữ liệu và
lịch sử đơn hàng chưa được lưu trong hồ sơ JSON CRM.

### Đăng nhập

```http
POST /api/auth/login
Content-Type: application/json

{"email":"sales@example.com","password":"<password>"}
```

Ví dụ phản hồi `200` (chỉ trích các trường cần dùng):

```json
{"token":"<session-token>","user":{"id":"<user-id>","email":"sales@example.com","role":"sales"}}
```

### Liệt kê, tìm kiếm và phân trang

`GET /api/customers` hỗ trợ `search`, `status`, `page` và `limit`; mặc định
`page=1`, `limit=20`. Kết quả là mảng đã phân trang, chưa có tổng số bản ghi.
`search` tìm chuỗi con không phân biệt hoa thường trong tên, email và điện
thoại. Trạng thái hỗ trợ `new`, `lead`, `customer`.

```http
GET /api/customers?search=demo&status=lead&page=1&limit=20
Authorization: Bearer <token>
```

```json
[
  {
    "id": "9d4604e4-c3b7-4c28-9446-0449d9966b1d",
    "name": "Khách hàng mẫu",
    "email": "demo@example.com",
    "phone": "+84000000001",
    "status": "lead",
    "created_by": "<user-id>",
    "updated_by": "<user-id>",
    "createdAt": "2026-10-19T00:00:00.000Z"
  }
]
```

`GET /api/admin/customers` là route tương thích cũ: trả tất cả hồ sơ đang hoạt
động, không có filter/phân trang.

### Tạo hồ sơ

`POST /api/customers` hoặc `POST /api/admin/customers` cần quyền `admin` hoặc
`sales`. Email được chuẩn hóa chữ thường; email và điện thoại phải duy nhất
trong các hồ sơ chưa xoá.

```http
POST /api/customers
Authorization: Bearer <token>
Content-Type: application/json

{"name":"Khách hàng mẫu","email":"demo@example.com","phone":"+84000000001"}
```

Phản hồi `201` có hồ sơ mới với `status: "new"` và thông tin audit của người
đăng nhập.

### Xem chi tiết

```http
GET /api/customers/<customer-id>
Authorization: Bearer <token>
```

Phản hồi `200` là một hồ sơ cùng cấu trúc với phần tử trong mảng danh sách.
Trả về `404` nếu ID không tồn tại hoặc hồ sơ đã bị xoá mềm.

### Cập nhật thông tin hoặc trạng thái

`PATCH` và `PUT /api/customers/:id` (cũng hỗ trợ prefix tương thích
`/api/admin`) cập nhật thông tin hồ sơ. Sales và admin có quyền; các trường
được hỗ trợ là `name`, `email`, `phone`. Có thể cập nhật lần lượt trạng thái
`new` → `lead` → `customer`; không thể bỏ qua bước hoặc quay lui.

```http
PATCH /api/customers/<customer-id>
Authorization: Bearer <token>
Content-Type: application/json

{"phone":"+84000000002"}
```

Đổi trạng thái dùng cùng endpoint với body `{"status":"lead"}`. Phản hồi
`200` chứa hồ sơ đã cập nhật. Email/số điện thoại trùng trả `409`, dữ liệu
không hợp lệ trả `400`, chuyển trạng thái sai thứ tự trả `409`.

### Xoá mềm

```http
DELETE /api/customers/<customer-id>
Authorization: Bearer <admin-token>
```

Chỉ admin được xoá. Phản hồi `200`: `{"success":true}`. Dữ liệu vẫn được giữ
trong JSON với `deletedAt`, nhưng bị loại khỏi truy vấn; email và điện thoại
có thể được dùng lại. Hồ sơ không tìm thấy trả `404`.

### Mã lỗi phổ biến

| Mã | Ý nghĩa |
| --- | --- |
| `400` | JSON hoặc trường đầu vào không hợp lệ |
| `401` | Thiếu hoặc không hợp lệ token/actor |
| `403` | Vai trò không có quyền thực hiện thao tác |
| `404` | Không tìm thấy hồ sơ còn hoạt động |
| `409` | Email/điện thoại bị trùng hoặc chuyển trạng thái không hợp lệ |

## Schema PostgreSQL và migration

`data/customer-schema.sql` là snapshot schema CRM chuẩn cho PostgreSQL 13 trở
lên. Các thay đổi triển khai được quản lý theo thứ tự tại `data/migrations/`;
`001_customer_crm.sql` là migration lịch sử, còn `002_align_customer_crm_schema.sql`
nâng cấp cấu trúc cũ về schema chuẩn. Email và số điện thoại được duy nhất
trong các hồ sơ đang hoạt động; hồ sơ soft-delete có thể nhường lại giá trị
đó. `data/customer-seed.sql` thêm 12 hồ sơ và 3 tương tác tổng hợp, dùng email
`example.com` và không chứa dữ liệu khách hàng thật.

Cài PostgreSQL client `psql`, tạo database development, rồi trong PowerShell
tại thư mục gốc dự án:

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@localhost:5432/booknest_dev"
npm.cmd run migrate
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data/customer-seed.sql
```

`npm run migrate` áp dụng từng file SQL theo thứ tự số, trong transaction,
ghi phiên bản vào `schema_migrations` và bỏ qua phiên bản đã áp dụng. Có thể
chạy lại an toàn; migration khóa advisory để tránh hai tiến trình cùng áp dụng.
Trên database đã chạy migration cũ, phiên bản 001 được xác nhận an toàn rồi
002 nâng cấp các bảng hiện có. Các trạng thái cũ `active`/`vip` được đổi thành
`customer`; `inactive`/`blocked` thành hồ sơ `new` đã soft-delete. Đơn hàng
`pending`/`confirmed` được chuẩn hóa thành `received`; các bản ghi và quan hệ
được giữ lại. Lỗi kiểm tra constraint sẽ rollback migration đang chạy, không
xóa dữ liệu.

Trước khi nâng cấp database có dữ liệu, tạo và xác minh backup theo
[backup/restore runbook](./backup-restore-incident-runbook.md). Migration chỉ
có tiến, không có lệnh down tự động; rollback là khôi phục backup trước
migration sau khi đã đánh giá các thay đổi phát sinh kể từ lúc backup. Không
chạy seed trên production. Không lưu URL có thông tin xác thực vào Git hoặc
log; dùng secret manager cho môi trường triển khai.

Kiểm tra dữ liệu sau khi chạy:

```powershell
psql "$env:DATABASE_URL" -c "SELECT count(*) FROM customers WHERE email LIKE 'crm-demo-%@example.com';"
```

Kết quả development sau seed là 12. Dữ liệu mẫu chỉ nằm trong PostgreSQL;
API Node.js hiện tại không đọc database này.

## Bảo mật và quyền riêng tư

- Không lưu mật khẩu gốc, token phiên hoặc dữ liệu thẻ thanh toán trong CRM.
- Bảo vệ PostgreSQL bằng TLS khi đi qua mạng, giới hạn quyền DB theo least
  privilege và giữ credentials/khóa mã hóa trong secret manager.
- File SQL chỉ tạo schema consent; API hiện tại chưa ghi nhận consent và
  chưa thực thi thời hạn lưu giữ, export hoặc ẩn danh. Trước khi dùng dữ liệu
  thật, cần triển khai luồng consent và quy trình xử lý yêu cầu quyền riêng
  tư theo chính sách đã phê duyệt.
- Migration chưa mã hóa trường ở tầng ứng dụng. Khi triển khai PostgreSQL
  với dữ liệu thật, cần cấu hình encryption-at-rest ở hạ tầng, cân nhắc mã
  hóa trường nhạy cảm bằng khóa được quản lý bên ngoài database, và mask
  email/điện thoại trong log.
- Chỉ dùng dữ liệu tổng hợp trong môi trường development. Không đưa bản sao
  database sản xuất, thông tin liên hệ thật hoặc secret vào repository.

## Kiểm thử

Chạy kiểm thử ứng dụng bằng `npm test`. Kiểm thử này xác minh thứ tự, tính lặp
và rollback của runner. Nếu `DATABASE_URL` được cấu hình, kiểm thử
`tests/postgres-migrations.test.js` cũng chạy migration trên schema PostgreSQL
tạm thời, kiểm tra dữ liệu cũ và schema sau nâng cấp, rồi xóa schema thử
nghiệm.
