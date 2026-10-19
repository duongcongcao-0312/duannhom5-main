# Triển khai BookNest

## Yêu cầu

- Node.js 20 trở lên hoặc Docker Engine hỗ trợ image Linux.
- Một thư mục bền vững, có quyền ghi, để lưu dữ liệu trong `/app/data`.
- HTTPS tại reverse proxy khi phục vụ qua mạng công cộng.

## Chạy trực tiếp bằng Node.js

```sh
npm ci --omit=dev
HOST=127.0.0.1 PORT=8000 npm start
```

Đặt `HOST=0.0.0.0` chỉ khi tiến trình nằm trong mạng/container được kiểm soát;
không expose cổng ứng dụng trực tiếp ra Internet. Cấu hình TLS và giới hạn truy
cập tại reverse proxy.

Ở production, cấp `ADMIN_EMAIL` hợp lệ và `ADMIN_PASSWORD` tối thiểu 12 ký tự
qua secret manager trước khi tạo server. Có thể đặt thêm `ADMIN_NAME`. Server từ
chối khởi động production nếu thiếu email/mật khẩu hợp lệ; tài khoản demo chỉ
được seed trong môi trường không phải production.

## Chạy bằng Docker

```sh
docker build -t booknest:0.1.0 .
docker volume create booknest-data
docker run -d --name booknest \
  --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  --env ADMIN_EMAIL \
  --env ADMIN_PASSWORD \
  --env ADMIN_NAME \
  -v booknest-data:/app/data \
  booknest:0.1.0
```

Các biến `ADMIN_*` trong lệnh trên phải được cấp sẵn từ secret manager của host;
không ghi giá trị bí mật trực tiếp vào shell history hoặc file trong repository.

Image xuất bản từ GitHub Actions có tên
`ghcr.io/duongcongcao-0312/duannhom5-main:<tag>`. Workflow chạy khi push tag
`v*`; maintainer cần tạo tag và cấu hình quyền/package visibility trên GitHub.

## Dữ liệu và tài khoản

BookNest lưu tài khoản, khách hàng CRM, sách quản trị, đơn hàng và yêu cầu dịch
vụ trong `/app/data`. Gắn volume bền vững trước khi nhận dữ liệu thật. Sao lưu
volume trước khi nâng phiên bản và thử khôi phục định kỳ. Bản phát hành hiện
không có migration tự động.

Tài khoản `admin@booknest.vn` / `admin123` chỉ được seed trong môi trường không
phải production. Production cần credentials riêng ngay từ lần khởi động đầu.
Phiên đăng nhập lưu trong bộ nhớ sẽ bị vô hiệu khi tiến trình khởi động lại.

## Kiểm tra sau deploy

```sh
curl --fail http://127.0.0.1:8000/api/books
curl --fail http://127.0.0.1:8000/
```

Sau đó kiểm tra thủ công đăng nhập quản trị, tải dashboard và một luồng mua
hàng với dữ liệu thử. Theo dõi log/container và dung lượng volume; quy trình
giám sát, rollback và thời gian quan sát sau deploy phụ thuộc nền tảng vận hành.

## Build và kiểm tra trước phát hành

```sh
npm ci
npm run check
npm test
npm run build:pages
npm audit --omit=dev
docker build -t booknest:0.1.0 .
```

`dist/` chỉ là build giao diện GitHub Pages; backend cần Node.js hoặc Docker.
GitHub Pages không chạy API, không lưu dữ liệu backend và không thay thế bước
triển khai máy chủ.