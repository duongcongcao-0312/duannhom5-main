# Hướng dẫn quản lý khách hàng

Tài liệu này mô tả CRM hiện tại của BookNest, gồm dữ liệu khách hàng, API,
quy trình seed/migration, kiểm thử và yêu cầu bảo mật. Tài liệu thiết kế đầy
đủ cho schema quan hệ nằm tại [crm-design.md](./crm-design.md).

## 1. Phạm vi và trạng thái triển khai

CRM file-backed hiện tại lưu hồ sơ tại `data/customers.json`. Tệp được tạo
trễ khi có hồ sơ đầu tiên; không cần chạy migration để khởi động local. Tài
khoản đăng nhập vẫn nằm trong `data/users.json`, còn đơn hàng và yêu cầu dịch
vụ nằm trong các tệp JSONL tương ứng.

API CRM đã triển khai:

- `GET/POST /api/customers`
- `GET/PATCH/PUT/DELETE /api/customers/:id`
- Các endpoint tương đương dưới `/api/admin/customers`
- `PATCH /api/auth/customer-info` cho thông tin liên hệ của chính tài khoản
- `GET /api/admin/users` cho danh sách tài khoản (không trả password)

Mọi endpoint CRM đều yêu cầu `Authorization: Bearer <token>`. Quyền được lấy
từ session phía server, không lấy từ payload:

| Vai trò | Xem | Tạo | Cập nhật | Xóa mềm |
| --- | --- | --- | --- | --- |
| `admin` | Có | Có | Có | Có |
| `sales` | Có | Có | Có | Không |
| `support` | Có | Không | Không | Không |
| `user` | Không | Không | Không | Không |

`/api/customers` và `/api/admin/customers` dùng chung service; tiền tố
`/admin` được giữ để tương thích với giao diện quản trị.

## 2. Schema và quy tắc dữ liệu

### Hồ sơ file-backed hiện tại

```json
{
  "id": "uuid",
  "name": "Nguyễn Văn A",
  "email": "a@example.com",
  "phone": "0901234567",
  "status": "new",
  "created_by": "user-uuid",
  "updated_by": "user-uuid",
  "createdAt": "2026-10-19T00:00:00.000Z"
}
```

Các giá trị `status` hợp lệ là `new`, `lead` và `customer`. `name` dài 2–120
ký tự; email tối đa 254 ký tự và được chuẩn hóa chữ thường; số điện thoại
phải có 8–15 chữ số sau khi bỏ dấu phân cách. Email hoặc số điện thoại trùng
với hồ sơ chưa xóa sẽ trả `409`.

Xóa khách hàng là xóa mềm: bản ghi giữ lại `deletedAt` và `deletedBy`, nhưng
không xuất hiện trong danh sách hoặc truy vấn chi tiết thông thường.

### Schema đích khi chuyển sang database

Schema quan hệ gồm `users`, `customers`, `customer_addresses`, `orders`,
`order_items`, `service_requests` và `consent_records`. Các khóa chính dùng
UUID; `customers.user_id` là khóa ngoại nullable và unique; email/phone có
index để tìm kiếm; đơn hàng lưu snapshot tên, điện thoại và địa chỉ tại thời
điểm đặt. Không đưa password hash, session token hoặc dữ liệu thẻ vào CRM.

Xem bảng trường, index, retention và consent tại
[crm-design.md](./crm-design.md#mo-hinh-quan-he).

## 3. Xác thực và seed

Khởi động server sẽ gọi `Database.init()`:

```powershell
npm start
```

Nếu `data/users.json` chưa tồn tại, server seed tài khoản admin local:

```text
Email: admin@booknest.vn
Mật khẩu: admin123
```

Đổi hoặc vô hiệu hóa tài khoản này trước khi mở server ra mạng. Không commit
file dữ liệu production.

CRM hiện chưa có lệnh migration/seed riêng. Khi chạy local sạch, chỉ cần tạo
thư mục `data/` và khởi động server; `users.json` được seed tự động,
`customers.json` được tạo khi gọi `POST /api/customers`. Khi chuyển sang
PostgreSQL/SQLite, migration phải:

1. Tạo bảng và index theo schema đích.
2. Import `users.json`, `orders.jsonl` và `service-requests.jsonl` theo
   transaction.
3. Chuẩn hóa email/phone và tạo một `customer` cho mỗi cặp định danh hợp lệ.
4. Ghi báo cáo bản ghi lỗi, không bỏ qua âm thầm.
5. Chạy kiểm tra số lượng, khóa ngoại, bản ghi trùng và snapshot đơn hàng.

Migration phải idempotent: chạy lại không tạo bản ghi khách hàng trùng. Sao
lưu thư mục `data/` trước khi import và chỉ xóa tệp cũ sau khi đối soát.

## 4. API và ví dụ

Trong các ví dụ dưới đây, `$TOKEN` là token trả về từ
`POST /api/auth/login`, còn `$ID` là UUID khách hàng.

### Đăng ký và đăng nhập để lấy token

```http
POST /api/auth/login
Content-Type: application/json

{"email":"admin@booknest.vn","password":"admin123"}
```

```json
{
  "token": "session-token",
  "user": {
    "id": "admin-master",
    "email": "admin@booknest.vn",
    "role": "admin",
    "customerInfo": {}
  }
}
```

### Danh sách khách hàng

```http
GET /api/customers?search=nguyen&status=lead&page=1&limit=20
Authorization: Bearer $TOKEN
```

Response `200` là mảng hồ sơ sau khi áp dụng bộ lọc và phân trang:

```json
[
  {"id":"$ID","name":"Nguyễn Văn A","email":"a@example.com","phone":"0901234567","status":"lead"}
]
```

`GET /api/admin/customers` có cùng query và response, dành cho client quản trị.

### Tạo khách hàng

```http
POST /api/customers
Authorization: Bearer $TOKEN
Content-Type: application/json

{"name":"Nguyễn Văn A","email":"a@example.com","phone":"0901234567"}
```

Response `201` là hồ sơ mới, bao gồm `id`, `status: "new"`, `created_by` và
`createdAt`. Email/phone trùng trả `409`; payload sai trả `400`.
`POST /api/admin/customers` có cùng body và response.

### Xem chi tiết

```http
GET /api/customers/$ID
Authorization: Bearer $TOKEN
```

Response `200`:

```json
{
  "id":"$ID",
  "name":"Nguyễn Văn A",
  "email":"a@example.com",
  "phone":"0901234567",
  "status":"new",
  "created_by":"admin-master",
  "updated_by":"admin-master",
  "createdAt":"2026-10-19T00:00:00.000Z"
}
```

`GET /api/admin/customers/$ID` tương đương. Hồ sơ không tồn tại hoặc đã xóa
trả `404`.

### Cập nhật thông tin hoặc trạng thái

```http
PATCH /api/customers/$ID
Authorization: Bearer $TOKEN
Content-Type: application/json

{"name":"Nguyễn Văn B","phone":"+84901234567"}
```

Đổi trạng thái dùng body riêng:

```http
PATCH /api/admin/customers/$ID
Authorization: Bearer $TOKEN
Content-Type: application/json

{"status":"customer"}
```

Response `200` là hồ sơ sau cập nhật. `PUT` được hỗ trợ như alias của `PATCH`;
chỉ `admin` và `sales` được ghi. Trạng thái sai trả `400`, không đủ quyền trả
`403`.

### Xóa mềm

```http
DELETE /api/admin/customers/$ID
Authorization: Bearer $TOKEN
```

Response `200`:

```json
{"success":true}
```

Chỉ `admin` được xóa mềm; dữ liệu bị xóa không xuất hiện ở `GET` danh sách.

### Cập nhật thông tin của tài khoản hiện tại

```http
PATCH /api/auth/customer-info
Authorization: Bearer $TOKEN
Content-Type: application/json

{"customerName":"Nguyễn Văn A","phone":"0901234567","address":"Số 1, Hà Nội"}
```

Response `200`:

```json
{"customerInfo":{"customerName":"Nguyễn Văn A","phone":"0901234567","address":"Số 1, Hà Nội"}}
```

Endpoint này chỉ cập nhật tài khoản thuộc session; không thay thế hồ sơ CRM
do nhân viên quản lý.

### Danh sách tài khoản cho admin

```http
GET /api/admin/users
Authorization: Bearer $TOKEN
```

Response `200` là mảng gồm `id`, `name`, `email`, `role`, `studentType`,
`studentId`, `createdAt`; không bao giờ trả `password`.

## 5. Bảo mật và privacy

- Bắt buộc HTTPS, giới hạn tốc độ cho login và endpoint dữ liệu cá nhân.
- Chỉ dùng Bearer token do server cấp; kiểm tra role ở server, không tin role
  từ trình duyệt.
- Validate độ dài/định dạng ở server; không ghi phone, địa chỉ, student ID
  hoặc token vào log.
- Dữ liệu production phải có quyền file hạn chế, backup mã hóa và encryption
  at rest khi chuyển sang database. Secret chỉ đặt trong biến môi trường.
- Consent phải ghi purpose (`order`, `service`, `marketing`), phiên bản policy,
  nguồn thu thập, thời hạn lưu giữ và thời điểm rút consent.
- Khi khách yêu cầu xóa, xóa/ẩn danh hồ sơ trong thời hạn chính sách; chỉ giữ
  snapshot đơn hàng tối thiểu nếu có nghĩa vụ kế toán/pháp lý.
- Không dùng `localStorage` làm nguồn sự thật cho CRM; chỉ dùng cache tối
  thiểu ở frontend và xóa cache khi người dùng yêu cầu.
- Chính sách hiển thị cho người dùng nằm tại [privacy.html](../privacy.html)
  và [terms.html](../terms.html).

## 6. Kiểm thử và checklist vận hành

```powershell
npm ci
npm test
npm run build:pages
npm audit --omit=dev
```

Các kiểm thử backend cần bao phủ: tạo hồ sơ hợp lệ, email/phone trùng,
validate dữ liệu xấu, lọc/phân trang, phân quyền `admin`/`sales`/`support`,
cập nhật trạng thái, xóa mềm, không lộ password và migration chạy lặp lại.

Trước production: backup `data/`, đổi admin mặc định, bật HTTPS, kiểm tra
`GET /api/admin/customers`, tạo/cập nhật/xóa thử một hồ sơ bằng tài khoản đúng
quyền, xác nhận `403` với tài khoản sai quyền và kiểm tra log không chứa PII.
