# BookNest

[![BookNest CI](https://github.com/duongcongcao-0312/duannhom5-main/actions/workflows/ci.yml/badge.svg)](https://github.com/duongcongcao-0312/duannhom5-main/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

BookNest là website nhà sách trực tuyến bằng tiếng Việt, xây dựng với HTML,
CSS, JavaScript thuần và máy chủ REST API chạy trên Node.js. Dự án minh hoạ
quy trình duyệt sách, đặt hàng và vận hành một cửa hàng sách trực tuyến.

## Mục lục

- [Tính năng](#tính-năng)
- [Công nghệ](#công-nghệ)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Cổng quản trị](#cổng-quản-trị)
- [Kiểm thử](#kiểm-thử)
- [API](#api)
- [Dữ liệu và lưu trữ](#dữ-liệu-và-lưu-trữ)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Thành viên và đóng góp](#thành-viên-và-đóng-góp)
- [Lưu ý bảo mật](#lưu-ý-bảo-mật)

## Tính năng

- Duyệt danh mục 80 đầu sách thuộc 10 thể loại; tìm theo tên hoặc tác giả,
  lọc thể loại và sắp xếp theo giá hoặc tên.
- Xem chi tiết sách, sách liên quan và đánh dấu sách yêu thích.
- Thêm sách vào giỏ, cập nhật số lượng, áp dụng mã ưu đãi và xem tổng tiền.
- Đặt hàng bằng chuyển khoản qua mã QR hoặc thanh toán khi nhận hàng (COD);
  máy chủ kiểm tra giá, lưu đơn và cấp mã để tra cứu.
- Đăng ký thuê, thu mua hoặc trao đổi sách; đăng ký tài khoản và đăng nhập.
- Quản lý đơn hàng, kho sách, yêu cầu dịch vụ và thành viên qua cổng quản trị.
- Giao diện tương thích với máy tính và điện thoại; có trang chi tiết sách,
  chính sách, điều khoản và trang lỗi.

## Công nghệ

- **Giao diện:** HTML, CSS và JavaScript thuần.
- **Máy chủ:** Node.js, HTTP API và lưu trữ dữ liệu dạng JSON/JSONL.
- **Kiểm thử:** Node.js test runner (`node:test`).
- **Tự động hoá:** GitHub Actions chạy kiểm thử và kiểm tra dependency.

## Cài đặt và chạy

Cần cài [Node.js 20 trở lên](https://nodejs.org/). Từ thư mục dự án, chạy:

```sh
npm ci
npm start
```

Mở <http://127.0.0.1:8000>. Máy chủ mặc định chỉ lắng nghe trên máy hiện tại.
Có thể cấu hình `PORT` và `HOST` nếu cần. Ví dụ trong PowerShell:

```powershell
$env:PORT = "8000"
$env:HOST = "127.0.0.1"
npm start
```

## Cổng quản trị

Mở <http://127.0.0.1:8000/admin.html> để đăng nhập và quản lý cửa hàng. Tài
khoản demo được khởi tạo khi chưa có tệp người dùng:

- **Email:** `admin@booknest.vn`
- **Mật khẩu:** `admin123`

Đây là thông tin đăng nhập dành riêng cho môi trường phát triển cục bộ; không
đưa máy chủ ra mạng công cộng khi còn sử dụng tài khoản mặc định.

## Kiểm thử

```sh
npm test
npm audit --omit=dev
```

GitHub Actions tự động cài dependency theo lockfile, chạy kiểm thử và kiểm tra
lỗ hổng dependency khi có push lên nhánh `main` hoặc pull request vào `main`.

## API

| Phương thức | Đường dẫn | Quyền hạn | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/coupons/:code` | Công khai | Kiểm tra mã ưu đãi |
| `POST` | `/api/orders` | Công khai | Xác thực và lưu đơn hàng |
| `GET` | `/api/orders/:id` | Công khai | Tra cứu trạng thái và chi tiết cơ bản của đơn |
| `POST` | `/api/auth/register` | Công khai | Đăng ký tài khoản |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập và nhận token |
| `GET` | `/api/auth/me` | Người dùng | Lấy thông tin tài khoản hiện tại |
| `POST` | `/api/auth/logout` | Người dùng | Đăng xuất |
| `GET` | `/api/books` | Công khai | Lấy danh mục sách |
| `POST` | `/api/services` | Công khai | Gửi yêu cầu thuê, thu mua hoặc trao đổi sách |
| `GET` | `/api/admin/stats` | Quản trị | Xem thống kê |
| `GET` | `/api/admin/orders` | Quản trị | Xem danh sách đơn hàng |
| `PATCH` | `/api/admin/orders/:id` | Quản trị | Cập nhật trạng thái đơn và thanh toán |
| `POST` | `/api/admin/books` | Quản trị | Thêm sách |
| `PUT` | `/api/admin/books/:id` | Quản trị | Cập nhật sách và tồn kho |
| `DELETE` | `/api/admin/books/:id` | Quản trị | Xoá sách |
| `GET` | `/api/admin/services` | Quản trị | Xem yêu cầu dịch vụ |
| `PATCH` | `/api/admin/services/:id` | Quản trị | Cập nhật trạng thái yêu cầu dịch vụ |
| `GET` | `/api/admin/users` | Quản trị | Xem danh sách thành viên |

## Dữ liệu và lưu trữ

Máy chủ lưu người dùng trong `data/users.json`, yêu cầu dịch vụ trong
`data/service-requests.jsonl`, sách quản trị thêm trong `data/books.json` và
đơn hàng trong `data/orders.jsonl`. Một số trạng thái giao diện như giỏ hàng,
sách yêu thích và phiên đăng nhập cũng được lưu trong `localStorage` của trình
duyệt.

`data/orders.jsonl` được bỏ qua bởi Git vì có thể chứa thông tin giao nhận.
Không đưa dữ liệu khách hàng thật hoặc thông tin nhạy cảm vào repository; hãy
bảo vệ và sao lưu các tệp dữ liệu phù hợp với nhu cầu triển khai.

## Cấu trúc dự án

```text
.
├── assets/                  # Biểu tượng và tài nguyên tĩnh
├── backend/
│   ├── auth.js              # Mã hoá mật khẩu và quản lý phiên
│   └── db.js                # Đọc và ghi dữ liệu JSON/JSONL
├── data/                    # Dữ liệu người dùng, sách và yêu cầu dịch vụ
├── tests/                   # Kiểm thử giao diện và API
├── .github/workflows/       # Quy trình CI
├── admin.html               # Giao diện cổng quản trị
├── admin.css                # Kiểu dáng cổng quản trị
├── admin.js                 # Tương tác và gọi API quản trị
├── book.html                # Trang chi tiết sách
├── book-detail.js           # Tương tác trang chi tiết
├── books-data.js            # Danh mục sách mặc định
├── index.html               # Trang chủ cửa hàng
├── main.css                 # Kiểu dáng cửa hàng
├── main.js                  # Tương tác giao diện cửa hàng
├── server.js                # Máy chủ REST API và tệp tĩnh
└── package.json             # Lệnh dự án
```

## Thành viên và đóng góp

Thông tin dưới đây được tổng hợp từ commit và issue trên GitHub. Tên hiển thị
là tài khoản GitHub; phần đóng góp mô tả các hạng mục và khu vực mã nguồn có
thể đối chiếu, không phải chức danh chính thức.

| Thành viên | Công việc ghi nhận |
| --- | --- |
| [@duongcongcao-0312](https://github.com/duongcongcao-0312) | Khởi tạo và cập nhật dự án; phát triển luồng lưu và tra cứu đơn hàng, cập nhật tài liệu. [Issue #1](https://github.com/duongcongcao-0312/duannhom5-main/issues/1) |
| [@daoducanh1](https://github.com/daoducanh1) | Đóng góp cho phần máy chủ Node.js trong `server.js`; commit gắn với hạng mục đăng nhập/xác thực. [Issue #2](https://github.com/duongcongcao-0312/duannhom5-main/issues/2) |
| [@vothanhdat1th3-pixel](https://github.com/vothanhdat1th3-pixel) | Đóng góp cho logic giao diện trong `main.js`, bao gồm luồng biểu mẫu dịch vụ thuê, thu mua và trao đổi sách. [Issue #3](https://github.com/duongcongcao-0312/duannhom5-main/issues/3) |
| [@nguyennhatanh1427-gif](https://github.com/nguyennhatanh1427-gif) | Phát triển tương tác giỏ hàng, trang chi tiết sách và giao diện; bổ sung/cập nhật kiểm thử. [Issue #4](https://github.com/duongcongcao-0312/duannhom5-main/issues/4), [#6](https://github.com/duongcongcao-0312/duannhom5-main/issues/6), [#7](https://github.com/duongcongcao-0312/duannhom5-main/issues/7) |
| [@HoangAnhdzvcl](https://github.com/HoangAnhdzvcl) | Đóng góp cho danh sách và chức năng sắp xếp sách theo giá, cùng các cập nhật liên quan ở giao diện, máy chủ và kiểm thử. [Issue #5](https://github.com/duongcongcao-0312/duannhom5-main/issues/5) |

## Lưu ý bảo mật

BookNest là dự án mẫu, chưa được thiết kế để vận hành với dữ liệu khách hàng
thật. Tài khoản demo mặc định, lưu trữ JSON trên đĩa, token phiên trong bộ nhớ
và một số thông tin phía trình duyệt không thay thế cho quy trình bảo mật của
một dịch vụ thương mại.

Trước khi triển khai thực tế, cần thay đổi cơ chế quản trị mặc định, dùng cơ
sở dữ liệu phù hợp có sao lưu, bật HTTPS, rà soát quyền truy cập và bổ sung
các biện pháp bảo vệ dữ liệu cá nhân. Máy chủ Node.js cần môi trường lưu trữ
được dữ liệu lâu dài; GitHub Pages chỉ phục vụ tệp tĩnh và không chạy được API.
