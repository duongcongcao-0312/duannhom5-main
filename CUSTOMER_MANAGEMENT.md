# Hướng dẫn quản lý khách hàng & CRM

Tài liệu này mô tả cách BookNest nên quản lý khách hàng, hội viên, dữ liệu giao nhận và đơn hàng trong môi trường demo cũng như khi mở rộng lên hệ thống CRM thực tế.

## 1. Mục tiêu

- Lưu trữ thông tin khách hàng một cách an toàn và có cấu trúc
- Hỗ trợ đăng ký / đăng nhập / thẻ hội viên / ưu đãi
- Theo dõi lịch sử đơn hàng và trạng thái giao hàng
- Với production: đảm bảo privacy, consent và bảo mật dữ liệu cá nhân (PII)

## 2. Bối cảnh hiện tại của repo

Repo hiện đang là một trang web static demo. Khách hàng được lưu trên browser `localStorage` và đơn hàng được ghi vào `data/orders.jsonl` bên server. Đây là cách hiệu quả cho local demo, nhưng không phải là chuẩn production.

Các key lưu dữ liệu hiện tại:

- `booknest-users`
- `booknest-current-user`
- `booknest-cart`
- `booknest-favorites`
- `booknest-coupon`
- `booknest-service-requests`

## 3. Schema gợi ý cho CRM

### 3.1 Bảng `customers`

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  student_type TEXT,
  student_id TEXT,
  member_number TEXT,
  marketing_consent BOOLEAN DEFAULT FALSE,
  terms_consent BOOLEAN DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Bảng `addresses`

```sql
CREATE TABLE addresses (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 Bảng `orders`

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  order_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  coupon_code TEXT,
  shipping_name TEXT NOT NULL,
  shipping_phone TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 Bảng `order_items`

```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  book_title TEXT NOT NULL,
  author TEXT,
  unit_price NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(12,2) NOT NULL
);
```

### 3.5 Bảng `service_requests`

```sql
CREATE TABLE service_requests (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  request_type TEXT NOT NULL,
  book_title TEXT NOT NULL,
  book_condition TEXT,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 4. Endpoint API đề xuất

### 4.1 Đăng ký khách hàng

- `POST /api/customers`

Request:

```json
{
  "name": "Nguyễn Văn A",
  "email": "nva@example.com",
  "password": "StrongPass!123",
  "phone": "+84901234567",
  "studentType": "student",
  "studentId": "SV12345",
  "consent": {
    "marketing": true,
    "termsAccepted": true
  }
}
```

Response:

```json
{
  "id": "7c52d9e2-f5e4-4ea6-9d47-4f7ec54a0cbf",
  "memberNumber": "BN12345678",
  "name": "Nguyễn Văn A",
  "email": "nva@example.com",
  "studentType": "student"
}
```

### 4.2 Đăng nhập

- `POST /api/customers/login`

Request:

```json
{
  "email": "nva@example.com",
  "password": "StrongPass!123"
}
```

Response:

```json
{
  "token": "jwt_or_session_token",
  "customer": {
    "id": "7c52d9e2-f5e4-4ea6-9d47-4f7ec54a0cbf",
    "name": "Nguyễn Văn A",
    "memberNumber": "BN12345678"
  }
}
```

### 4.3 Lấy hồ sơ khách hàng

- `GET /api/customers/:id`

Response:

```json
{
  "id": "7c52d9e2-f5e4-4ea6-9d47-4f7ec54a0cbf",
  "name": "Nguyễn Văn A",
  "email": "nva@example.com",
  "phone": "+84901234567",
  "studentType": "student",
  "memberNumber": "BN12345678"
}
```

### 4.4 Cập nhật hồ sơ

- `PATCH /api/customers/:id`

Request:

```json
{
  "phone": "+84987654321",
  "marketingConsent": false
}
```

### 4.5 Lấy lịch sử đặt hàng

- `GET /api/customers/:id/orders`

Response:

```json
[
  {
    "orderId": "3b17a7d1-34d4-4f5e-a0bf-81db7f0b3a0d",
    "status": "received",
    "total": 211500,
    "createdAt": "2026-10-14T07:22:10.837Z"
  }
]
```

## 5. Cách chạy migration và seed

Trong production nên dùng migration tool rõ ràng, ví dụ:

```sh
npm run migrate
npm run seed
```

Đối với repo hiện tại, dữ liệu seed chú trọng vào catalog sách `books-data.js` và các mã ưu đãi `BOOKNEST10`, `WELCOME5`.

Khuyến nghị seed data mẫu:

- 1 khách hàng demo
- 2 địa chỉ demo
- 3 đơn hàng demo
- 3 yêu cầu dịch vụ demo
- 2 coupon mặc định

## 6. Security & privacy

### 6.1 Consent

- Bắt buộc khách hàng tick vào checkbox `termsAccepted`
- Marketing email chỉ gửi nếu `marketingConsent = true`
- Lưu `consentAt` để ghi lại thời điểm đồng ý

### 6.2 Bảo mật

- Password lưu dưới dạng hashed (bcrypt/argon2)
- Không lưu password rõ trên database hay localStorage
- Hạn chế quyền truy cập DB theo least-privilege
- Chỉ cho phép log dữ liệu tối thiểu và không log password, token, thông tin nhạy cảm không cần thiết
- Bật TLS và bảo vệ API với rate limiting

### 6.3 Retention

- Xoá dữ liệu khách hàng không còn cần thiết sau thời gian retention quy định
- Xử lý `right to delete`, `right to access`, `right to correct` theo GDPR/PDPA nếu vận hành ở Việt Nam và quốc tế

## 7. Test plan đề xuất

- Unit test: validation `email`, `phone`, `consent`
- Integration test: tạo user, đăng nhập, gọi `/api/orders`
- Contract test: response JSON không leak PII
- Security test: đảm bảo mật khẩu không xuất hiện trong response
- E2E test: đặt hàng, tra cứu đơn, xem ưu đãi hội viên

## 8. Kết luận

Dự án BookNest đang ở mức demo local với dữ liệu tạm thời. Tuy nhiên, các mô hình `customers`, `orders`, `addresses` và `service_requests` đã cho thấy hướng tiếp cận đúng cho một hệ thống CRM/khách hàng thực tế. Khi triển khai production, ưu tiên chuyển từ `localStorage`/JSONL sang DB mạnh hơn, đồng thời tuân thủ privacy, consent và bảo mật dữ liệu cá nhân.
