# BookNest

BookNest là storefront sách trực tuyến của Việt Nam, với catalog, giỏ hàng, thanh toán, tra cứu đơn và luồng khách hàng. Dự án hiện chạy ở chế độ demo local/static, nhưng có cấu trúc dữ liệu và REST API đủ để mở rộng thành hệ thống thương mại điện tử hoặc CRM thực tế.

## 1. Yêu cầu

- Node.js 20+
- npm (đi kèm với Node.js)

## 2. Khởi chạy nhanh

Từ thư mục dự án:

```sh
npm install
npm start
```

Mở http://127.0.0.1:8000

### 2.1 Cấu hình môi trường

Sao chép file mẫu và chỉnh sửa nếu cần:

```sh
copy .env.example .env
```

File `.env.example` có nội dung mặc định:

```env
PORT=8000
HOST=127.0.0.1
NODE_ENV=development
```

Nếu bạn chạy trên Windows PowerShell và bị chặn bởi chính sách script, chạy trước:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
npm start
```

## 3. Tính năng chính

- Duyệt danh mục sách theo thể loại, tìm kiếm và sắp xếp
- Xem chi tiết sách, sách liên quan và yêu thích
- Thêm vào giỏ hàng, quản lý số lượng và áp dụng mã ưu đãi
- Đặt hàng với COD hoặc chuyển khoản QR
- Đăng ký/đăng nhập tài khoản người dùng
- Quản lý đơn hàng, khách hàng, dịch vụ và thống kê qua admin API
- Giao diện responsive cho desktop và mobile

## 4. Cấu trúc dữ liệu demo

Trong môi trường local, dữ liệu khách hàng, đơn hàng và yêu cầu dịch vụ được lưu theo cách an toàn và phù hợp cho demo:

- `localStorage` trên browser:
  - `booknest-users`
  - `booknest-current-user`
  - `booknest-cart`
  - `booknest-favorites`
  - `booknest-coupon`
  - `booknest-service-requests`
- File-backed storage:
  - `data/orders.jsonl` lưu đơn hàng thực tế
  - `data/customers.json` lưu thông tin khách hàng quản lý bằng CRM
  - `data/users.json` lưu tài khoản và admin

Lưu ý: `data/orders.jsonl` và các file có thông tin nhạy cảm nên được giữ ngoài repo hoặc cấu hình quyền truy cập phù hợp trong production.

## 5. API chính

### 5.1 Tạo đơn hàng

- Method: `POST`
- Path: `/api/orders`

### 5.2 Tra cứu đơn hàng

- Method: `GET`
- Path: `/api/orders/:orderId`

### 5.3 Kiểm tra mã ưu đãi

- Method: `GET`
- Path: `/api/coupons/:code`

### 5.4 Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/customer-info`
- `POST /api/auth/logout`

## 6. Kiểm thử

```sh
npm test
```

Hoặc chạy trực tiếp:

```sh
node --test tests/site.test.js tests/backend.test.js
```

## 7. Lưu ý production

- Không dùng `localStorage` như backend nguồn sự thật cho production
- Cần HTTPS, rate limiting, auth/session rõ ràng
- Chuyển từ JSONL sang database (PostgreSQL/MySQL) nếu mở rộng hệ thống
- Mã hóa mật khẩu bằng bcrypt/argon2 và không lưu dữ liệu nhạy cảm dạng plaintext

## 8. Cấu trúc dự án

```text
.
├── assets/
├── backend/
├── data/
├── scripts/
├── tests/
├── .env.example
├── .github/
├── index.html
├── main.js
├── main.css
├── server.js
├── README.md
└── package.json
```

## 9. Tham khảo

- [CUSTOMER_MANAGEMENT.md](./CUSTOMER_MANAGEMENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

Dự án này hiện hỗ trợ demo local và kiểm thử tự động; production cần tách API, database và cơ chế auth/session phù hợp.
