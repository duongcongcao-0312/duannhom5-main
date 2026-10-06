# BookNest

BookNest là website nhà sách trực tuyến bằng tiếng Việt, được xây dựng với
HTML, CSS và JavaScript thuần. Website có giao diện theo chủ đề bốn mùa, danh
mục sách và máy chủ Node.js để tiếp nhận, lưu và tra cứu đơn hàng.

## Tính năng

- Khám phá 80 đầu sách thuộc 10 thể loại; tìm theo tên sách hoặc tác giả, lọc
  thể loại và sắp xếp theo giá hoặc tên.
- Xem trang chi tiết, sách liên quan, điều hướng giữa các đầu sách và đánh dấu
  sách yêu thích.
- Thêm sách vào giỏ, điều chỉnh số lượng, áp dụng mã giảm giá và xem tổng tiền.
- Đặt hàng bằng chuyển khoản qua mã QR hoặc thanh toán khi nhận hàng (COD).
  Máy chủ kiểm tra sách và tính giá, lưu đơn hàng rồi trả mã đơn để tra cứu.
- Đăng ký thuê, thu mua và trao đổi sách; có trợ lý hỏi đáp và ưu đãi tài khoản.
- Bố cục tương thích với máy tính và điện thoại, kèm trang chính sách, điều
  khoản và trang lỗi.

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

## Chạy trên máy

Cần cài Node.js 20 trở lên. Tại thư mục dự án, chạy:

```sh
npm ci
npm start
```

Mở <http://127.0.0.1:8000> trên trình duyệt. Có thể đặt cổng hoặc địa chỉ máy
chủ bằng biến môi trường `PORT` và `HOST`; mặc định là cổng `8000` và địa chỉ
`127.0.0.1`.

## Kiểm thử và kiểm tra gói

```sh
npm test
npm audit --omit=dev
```

GitHub Actions cũng cài các gói theo lockfile, chạy kiểm thử và kiểm tra lỗ
hổng dependency khi có push lên nhánh `main` hoặc pull request.

## Đơn hàng và API

Máy chủ lưu mỗi đơn thành một dòng JSON trong `data/orders.jsonl`. Tệp này có
thông tin giao nhận của khách hàng, đã được thêm vào `.gitignore` để không bị
đẩy lên Git. Hãy bảo vệ và sao lưu tệp nếu cần giữ dữ liệu đơn hàng; không dùng
dữ liệu khách thật trong môi trường thử nghiệm.

Các API hiện có:

| Phương thức | Đường dẫn | Quyền hạn | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/coupons/:code` | Công khai | Kiểm tra mã ưu đãi |
| `POST` | `/api/orders` | Công khai | Xác thực và lưu đơn hàng |
| `GET` | `/api/orders/:id` | Công khai | Tra cứu trạng thái và chi tiết cơ bản của đơn |
| `POST` | `/api/auth/register` | Công khai | Đăng ký tài khoản (mã hoá scrypt) |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập và nhận token xác thực |
| `GET` | `/api/auth/me` | Người dùng | Lấy thông tin tài khoản hiện tại |
| `POST` | `/api/auth/logout` | Người dùng | Đăng xuất tài khoản |
| `GET` | `/api/books` | Công khai | Lấy toàn bộ danh mục sách |
| `POST` | `/api/services` | Công khai | Gửi yêu cầu thuê, thu mua, trao đổi sách |
| `GET` | `/api/admin/stats` | Quản trị | Thống kê doanh thu, đơn hàng, người dùng |
| `GET` | `/api/admin/orders` | Quản trị | Xem danh sách đầy đủ tất cả đơn hàng |
| `PATCH` | `/api/admin/orders/:id` | Quản trị | Cập nhật trạng thái đơn và thanh toán |
| `POST` | `/api/admin/books` | Quản trị | Thêm sách mới vào hệ thống |
| `PUT` | `/api/admin/books/:id` | Quản trị | Cập nhật thông tin và tồn kho sách |
| `DELETE` | `/api/admin/books/:id` | Quản trị | Xoá sách khỏi hệ thống |
| `GET` | `/api/admin/services` | Quản trị | Xem các yêu cầu dịch vụ sách |
| `PATCH` | `/api/admin/services/:id` | Quản trị | Cập nhật trạng thái yêu cầu dịch vụ |
| `GET` | `/api/admin/users` | Quản trị | Xem danh sách thành viên |

## Cổng quản trị (Admin Portal)

Hệ thống có trang quản trị chuyên biệt tại đường dẫn: <http://127.0.0.1:8000/admin.html>.
- **Tài khoản quản trị viên mặc định**: `admin@booknest.vn`
- **Mật khẩu**: `admin123`

Trang quản trị cho phép:
1. **Bảng điều khiển**: Thống kê doanh thu, số đơn hàng đang xử lý, số sách, số thành viên.
2. **Quản lý đơn hàng**: Xem chi tiết người nhận (tên, SĐT, địa chỉ, phương thức COD/QR), lọc theo trạng thái và đổi trạng thái đơn (Mới nhận, Đang xử lý, Đang giao, Hoàn tất, Đã huỷ).
3. **Quản lý kho sách**: Thêm sách mới (tiêu đề, tác giả, thể loại, giá, tồn kho, ảnh bìa, mô tả), chỉnh sửa hoặc xoá sách.
4. **Yêu cầu dịch vụ**: Tiếp nhận và chuyển trạng thái các yêu cầu thuê/thu mua/đổi sách của bạn đọc.
5. **Thành viên**: Xem danh sách thành viên, vai trò và phân loại đối tượng (Học sinh / Sinh viên / Khách hàng).

## Cấu trúc mã nguồn

```text
.
├── assets/                 # Biểu tượng và tài nguyên tĩnh
├── backend/                # Xử lý phía máy chủ (Backend)
│   ├── auth.js             # Mã hoá mật khẩu scrypt & quản lý token phiên
│   └── db.js               # Lưu trữ dữ liệu (Users, Books, Services, Orders)
├── data/                   # Thư mục dữ liệu (Users, Orders, Services)
├── tests/                  # Kiểm thử giao diện và API
│   ├── site.test.js        # Kiểm thử giao diện storefront & API đơn hàng
│   └── backend.test.js     # Kiểm thử toàn bộ API Backend & Admin
├── admin.html              # Giao diện trang quản trị Admin
├── admin.css               # Phong cách trang quản trị
├── admin.js                # Tương tác và gọi API trang quản trị
├── books-data.js           # Danh mục sách dùng chung
├── book.html               # Trang chi tiết sách
├── book-detail.js          # Tương tác cho trang chi tiết
├── index.html              # Trang chủ cửa hàng
├── main.css                # Giao diện và bố cục responsive
├── main.js                 # Tương tác giao diện và tích hợp API
└── server.js               # Máy chủ Node.js REST API & tĩnh
```

## Lưu ý khi triển khai

Đây là ứng dụng mẫu. Tài khoản người dùng và yêu cầu thuê/thu mua/trao đổi hiện
được lưu trong `localStorage` của trình duyệt; chúng chưa được xác thực hoặc
đồng bộ an toàn qua máy chủ. Vì vậy, không dùng website để xử lý mật khẩu hay
thông tin khách hàng thật.

Để triển khai thực tế, cần bổ sung xác thực phía máy chủ, cơ sở dữ liệu có sao
lưu, HTTPS, kiểm soát quyền truy cập đơn hàng và cơ chế bảo vệ dữ liệu cá nhân.
Ứng dụng cần môi trường lưu được dữ liệu lâu dài để giữ đơn hàng; GitHub Pages
chỉ lưu trữ tệp tĩnh nên không chạy được API Node.js.
