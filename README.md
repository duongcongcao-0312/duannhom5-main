# BookNest

BookNest là ứng dụng bán sách trực tuyến gồm storefront cho khách hàng, API Node.js và cổng quản trị. Dự án hỗ trợ duyệt danh mục, tìm kiếm, giỏ hàng, đặt hàng, tra cứu đơn, tài khoản người dùng và quản lý dữ liệu ở quy mô demo/local.

> **Trạng thái:** Đây là dự án demo. Không sử dụng với dữ liệu khách hàng thật hoặc thanh toán thật nếu chưa bổ sung đầy đủ cơ chế bảo mật, lưu trữ giao dịch, giám sát và sao lưu.

## Mục lục

- [Tính năng](#tính-năng)
- [Công nghệ và kiến trúc](#công-nghệ-và-kiến-trúc)
- [Yêu cầu](#yêu-cầu)
- [Cài đặt và chạy local](#cài-đặt-và-chạy-local)
- [Cấu hình môi trường](#cấu-hình-môi-trường)
- [Các lệnh npm](#các-lệnh-npm)
- [API](#api)
- [Cổng quản trị](#cổng-quản-trị)
- [Dữ liệu và lưu trữ](#dữ-liệu-và-lưu-trữ)
- [Kiểm thử](#kiểm-thử)
- [Triển khai](#triển-khai)
- [Bảo mật](#bảo-mật)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)
- [Đóng góp](#đóng-góp)

## Tính năng

- Duyệt sách theo danh mục, tìm kiếm và sắp xếp.
- Xem chi tiết sách, sách liên quan và danh sách yêu thích.
- Thêm sản phẩm vào giỏ hàng, cập nhật số lượng và áp dụng mã ưu đãi.
- Đặt hàng bằng COD hoặc chuyển khoản QR.
- Đăng ký, đăng nhập, đăng xuất và cập nhật thông tin khách hàng.
- Tra cứu đơn hàng theo mã đơn.
- Gửi yêu cầu thuê, thu mua hoặc trao đổi sách.
- Cổng quản trị cho đơn hàng, sách, dịch vụ, người dùng và thống kê.
- Giao diện responsive cho desktop và mobile.
- Tùy chọn đăng ký bằng Google/Facebook qua Firebase Authentication nếu đã cấu hình.

## Công nghệ và kiến trúc

- **Frontend:** HTML, CSS và JavaScript thuần; có thể build thành static site cho GitHub Pages.
- **Backend:** Node.js HTTP server trong `server.js`, cung cấp static files và REST API.
- **Xác thực:** logic phiên và băm mật khẩu trong `backend/auth.js`.
- **Lưu trữ local/demo:** JSON và JSONL trong thư mục `data/`.
- **Lưu trữ cloud tùy chọn:** PostgreSQL/Supabase khi cấu hình `DATABASE_URL`.
- **Kiểm thử:** `node:test`.
- **Triển khai:** GitHub Pages cho frontend; Render hoặc máy chủ Node.js riêng cho backend.

Frontend không tự chạy API trên GitHub Pages. Khi deploy tách frontend và backend, frontend phải được cấu hình `API_BASE_URL` trỏ tới backend HTTPS và backend phải cho phép origin của frontend qua `CORS_ORIGINS`.

## Yêu cầu

- Node.js 20 trở lên.
- npm đi kèm Node.js.
- PostgreSQL chỉ bắt buộc cho các luồng migration/seed hoặc khi muốn dùng database cloud.

## Cài đặt và chạy local

Từ thư mục gốc của repository:

```sh
npm install
npm start
```

Mở storefront tại <http://127.0.0.1:8000>. Cổng quản trị nằm tại <http://127.0.0.1:8000/admin.html>.

Trên Windows PowerShell, nếu chính sách thực thi script chặn npm, có thể chạy trong phiên hiện tại:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
npm start
```

## Cấu hình môi trường

Tạo `.env` local từ file mẫu. Trên Windows Command Prompt:

```bat
copy .env.example .env
```

Trên macOS/Linux hoặc PowerShell:

```sh
cp .env.example .env
```

Các biến thường dùng:

| Biến | Mục đích |
| --- | --- |
| `PORT` | Cổng HTTP của backend; local thường dùng `8000`. |
| `HOST` | Địa chỉ bind của backend; local nên dùng `127.0.0.1`, môi trường cloud thường dùng `0.0.0.0`. |
| `NODE_ENV` | Môi trường chạy, ví dụ `development` hoặc `production`. |
| `DATABASE_URL` | Connection string PostgreSQL; chỉ cấu hình trong secret manager hoặc biến môi trường của dịch vụ deploy. |
| `ADMIN_EMAIL` | Email quản trị do maintainer tự đặt trong môi trường deploy. |
| `ADMIN_PASSWORD` | Mật khẩu quản trị mạnh, tối thiểu 12 ký tự và không dùng lại mật khẩu dịch vụ database. |
| `CORS_ORIGINS` | Danh sách origin frontend được phép, phân tách bằng dấu phẩy. Không thêm path hoặc dấu `/` cuối origin. |
| `API_BASE_URL` | URL backend được frontend sử dụng khi build Pages; nên cấu hình bằng GitHub Actions Variable, không phải secret nếu chỉ là URL công khai. |

**Không commit `.env`, connection string, mật khẩu, token hoặc dữ liệu khách hàng.** Nếu một secret đã từng xuất hiện trong repository, cần thu hồi và tạo secret mới; chỉ xóa khỏi file là chưa đủ.

## Các lệnh npm

| Lệnh | Mô tả |
| --- | --- |
| `npm start` | Khởi động Node.js server. |
| `npm test` | Chạy toàn bộ test storefront và backend. |
| `npm run test:coverage` | Chạy test kèm báo cáo coverage của Node.js. |
| `npm run build:pages` | Tạo thư mục `dist/` cho frontend tĩnh. |
| `npm run migrate` | Chạy migration PostgreSQL khi có `DATABASE_URL`. |
| `npm run seed:customers` | Seed dữ liệu CRM mẫu cho development; không chạy trên production có dữ liệu thật. |
| `npm run audit` | Chạy `npm audit --omit=dev`. |

## API

Các endpoint chính hiện có:

| Phương thức | Đường dẫn | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/books` | Công khai | Lấy danh mục sách. |
| `GET` | `/api/coupons/:code` | Công khai | Kiểm tra mã ưu đãi. |
| `POST` | `/api/orders` | Công khai | Xác thực và lưu đơn hàng. |
| `GET` | `/api/orders/:id` | Công khai | Tra cứu trạng thái và thông tin cơ bản của đơn. |
| `POST` | `/api/services` | Công khai | Gửi yêu cầu thuê, thu mua hoặc trao đổi sách. |
| `POST` | `/api/auth/register` | Công khai | Đăng ký tài khoản. |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập và nhận phiên xác thực. |
| `GET` | `/api/auth/me` | Người dùng | Lấy thông tin tài khoản hiện tại. |
| `PATCH` | `/api/auth/customer-info` | Người dùng | Cập nhật thông tin liên hệ. |
| `POST` | `/api/auth/logout` | Người dùng | Đăng xuất. |
| `GET` | `/api/admin/stats` | Quản trị | Lấy thống kê. |
| `GET` | `/api/admin/orders` | Quản trị | Liệt kê đơn hàng. |
| `PATCH` | `/api/admin/orders/:id` | Quản trị | Cập nhật trạng thái đơn/thanh toán. |
| `POST` | `/api/admin/books` | Quản trị | Thêm sách. |
| `PUT` | `/api/admin/books/:id` | Quản trị | Cập nhật sách và tồn kho. |
| `DELETE` | `/api/admin/books/:id` | Quản trị | Xóa sách. |
| `GET` | `/api/admin/services` | Quản trị | Liệt kê yêu cầu dịch vụ. |
| `PATCH` | `/api/admin/services/:id` | Quản trị | Cập nhật yêu cầu dịch vụ. |
| `GET` | `/api/admin/users` | Quản trị | Liệt kê người dùng. |

## Cổng quản trị

Mở `/admin.html` sau khi server khởi động. Tính năng gồm:

1. Xem thống kê doanh thu, đơn hàng, sách và thành viên.
2. Xem, lọc và cập nhật trạng thái đơn hàng.
3. Thêm, sửa, xóa sách và quản lý tồn kho.
4. Tiếp nhận và cập nhật yêu cầu thuê/thu mua/đổi sách.
5. Xem người dùng, vai trò và thông tin phân loại.

Thông tin quản trị phải được cung cấp qua `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong môi trường chạy. Nếu mã nguồn hoặc dữ liệu development có credential mẫu, credential đó chỉ dùng để kiểm thử local và phải được đổi trước khi chia sẻ hoặc deploy; README không cung cấp mật khẩu mặc định.

## Dữ liệu và lưu trữ

### Local/demo

- `localStorage` của trình duyệt lưu trạng thái giao diện như giỏ hàng, yêu thích và một số thông tin phiên.
- `data/orders.jsonl` lưu mỗi đơn hàng trên một dòng JSON.
- `data/users.json`, `data/books.json` và các file dữ liệu liên quan lưu dữ liệu backend dạng file nếu không có database.
- Danh mục mặc định nằm trong `books-data.js`.

Các file trong `data/` có thể chứa thông tin giao nhận hoặc dữ liệu cá nhân. Không commit dữ liệu thật và cần giới hạn quyền truy cập thư mục này.

### PostgreSQL/Supabase

Khi có `DATABASE_URL`, backend và các script CRM có thể sử dụng PostgreSQL. Migration tạo các bảng CRM cần thiết; seed chỉ dành cho development. Dữ liệu JSON/JSONL cũ không tự động được import vào PostgreSQL, cần lập kế hoạch migration và sao lưu riêng.

Phiên đăng nhập hiện được lưu trong bộ nhớ tiến trình backend, vì vậy có thể mất khi service khởi động lại và không phù hợp cho nhiều instance. Production nên dùng session store dùng chung hoặc cơ chế xác thực phù hợp.

## Kiểm thử

```sh
npm test
```

Chạy trực tiếp hai file test:

```sh
node --test tests/site.test.js tests/backend.test.js
```

Trước khi phát hành nên chạy:

```sh
npm ci
npm test
npm run build:pages
npm audit --omit=dev
```

## Triển khai

### Frontend trên GitHub Pages

1. Chạy `npm run build:pages`.
2. Workflow GitHub Actions deploy thư mục `dist/`.
3. Đặt `API_BASE_URL` trong GitHub Actions Variables nếu backend không dùng URL mặc định.
4. Đảm bảo frontend gọi backend qua HTTPS.

### Backend trên Render

File `render.yaml` định nghĩa service Node.js, chạy `npm ci`, khởi động bằng `npm start` và health check tại `/api/books`. Cấu hình các giá trị nhạy cảm trong Render Environment/Secret Variables:

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Đặt `HOST=0.0.0.0` trên Render và cấu hình `CORS_ORIGINS` đúng origin của GitHub Pages hoặc domain frontend. Không dùng mật khẩu Supabase làm mật khẩu quản trị BookNest.

Sau khi deploy, kiểm tra tối thiểu:

- Trang chủ và file tĩnh.
- `GET /api/books`.
- Đăng ký/đăng nhập.
- Tạo đơn COD ở môi trường test.
- Tra cứu đơn hàng.
- Quyền truy cập các endpoint quản trị.

Sao lưu dữ liệu trước khi nâng cấp hoặc rollback. GitHub Pages chỉ phục vụ frontend tĩnh và không chạy được Node.js API.

## Bảo mật

BookNest hiện phù hợp cho demo, chưa phải cấu hình production hoàn chỉnh. Trước khi vận hành thực tế:

- Bật HTTPS và giới hạn `CORS_ORIGINS`.
- Dùng mật khẩu quản trị mạnh, duy nhất; không dùng credential mẫu.
- Không lưu secret, token, mật khẩu hoặc dữ liệu cá nhân trong repository.
- Không dùng `localStorage` làm nguồn dữ liệu đáng tin cậy cho đơn hàng hoặc quyền truy cập.
- Kiểm tra và giới hạn quyền truy cập các route quản trị.
- Validate dữ liệu đầu vào và giới hạn tốc độ cho các endpoint nhạy cảm.
- Băm mật khẩu bằng cơ chế phù hợp và bảo vệ session/token.
- Bảo vệ, sao lưu và mã hóa dữ liệu đơn hàng khi cần.
- Chạy `npm audit --omit=dev` và cập nhật dependency định kỳ.
- Không chạy seed dữ liệu mẫu trên production.

### Đăng ký Google/Facebook

Nếu bật Firebase Authentication, cấu hình provider trong Firebase Console và chỉ đặt các giá trị web public trong `assets/firebase-config.js`. Không đặt provider client secret, Facebook App Secret hoặc private credential trong frontend. Domain sử dụng phải được thêm vào danh sách Authorized domains và website phải chạy qua HTTPS, hoặc localhost khi development.

## Cấu trúc dự án

```text
.
├── assets/                 # Tài nguyên tĩnh và cấu hình frontend public
├── backend/                # Xác thực và truy cập dữ liệu backend
│   ├── auth.js
│   └── db.js
├── data/                   # Dữ liệu local; không commit dữ liệu thật
├── scripts/                # Build Pages, migration và seed
├── tests/                  # Test storefront và backend
├── .github/workflows/      # CI/CD
├── admin.html              # Giao diện quản trị
├── admin.css
├── admin.js
├── book.html               # Trang chi tiết sách
├── book-detail.js
├── books-data.js           # Catalog mặc định
├── index.html              # Storefront
├── main.css
├── main.js
├── server.js               # Static server và REST API
├── render.yaml             # Cấu hình Render
├── package.json
└── README.md
```

## Tài liệu tham khảo

- [Kiến trúc hệ thống](ARCHITECTURE.md)
- [Quản lý khách hàng](docs/CUSTOMER_MANAGEMENT.md)
- [Thiết kế CRM](docs/crm-design.md)
- [Lịch sử thay đổi](CHANGELOG.md)

## Đóng góp

1. Tạo branch cho thay đổi.
2. Chạy `npm test` và các kiểm tra phù hợp.
3. Không commit `.env`, secret hoặc dữ liệu thật.
4. Mô tả rõ thay đổi và ảnh hưởng tới cấu hình/deploy trong pull request.

Thông tin đóng góp của thành viên nên được đối chiếu từ commit, issue và pull request thực tế thay vì suy diễn chức danh.
