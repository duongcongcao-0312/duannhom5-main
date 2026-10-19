# BookNest

BookNest là storefront sách trực tuyến của Việt Nam, với catalog, giỏ hàng, thanh toán, tra cứu đơn và luồng khách hàng. Dự án hiện chạy ở chế độ demo local/static, nhưng có cấu trúc dữ liệu và REST API đủ để mở rộng thành hệ thống thương mại điện tử hoặc CRM thực tế.

## 1. Yêu cầu

- Node.js 20+
- npm (đi kèm với Node.js)

- [Tính năng](#tính-năng)
- [Công nghệ](#công-nghệ)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Cổng quản trị](#cổng-quản-trị)
- [Kiểm thử](#kiểm-thử)
- [Phát hành và triển khai production](#phát-hành-và-triển-khai-production)
- [API](#api)
- [Quản lý khách hàng](#quản-lý-khách-hàng)
- [Dữ liệu và lưu trữ](#dữ-liệu-và-lưu-trữ)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Kiến trúc phần mềm](#kiến-trúc-phần-mềm)
- [Yêu cầu phi chức năng](#yêu-cầu-phi-chức-năng)
- [Bảo mật của hệ thống](#bảo-mật-của-hệ-thống)
- [Thành viên và đóng góp](#thành-viên-và-đóng-góp)
- [Lưu ý bảo mật](#lưu-ý-bảo-mật)

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

  ### Migration và seed CRM

  Migration PostgreSQL tạo các bảng `customers`, `customer_interactions` và
  `customer_orders` theo cách idempotent. Cần đặt `DATABASE_URL`, sau đó chạy:

  ```powershell
  npm run migrate
  npm run seed:customers
  ```

  Seed tạo 12 khách hàng mẫu và một tương tác mẫu cho mỗi khách. Nếu không có
  `DATABASE_URL`, `npm run seed:customers` sẽ seed idempotent vào
  `data/customers.json` để kiểm tra API file-backed local. Dữ liệu mẫu chỉ dành
  cho development; không chạy seed trên production có dữ liệu thật.

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

## Phát hành và triển khai production

Thay đổi phát hành được ghi trong [CHANGELOG.md](CHANGELOG.md). Trước khi tạo
tag, maintainer cần chạy đầy đủ các lệnh kiểm tra:

```sh
npm ci
npm test
npm run build:pages
npm audit --omit=dev
```

`npm run build:pages` tạo thư mục `dist/` chỉ gồm các tệp giao diện được phép
đưa lên GitHub Pages. Workflow Pages sẽ tự động build và deploy thư mục này
trên nhánh `main`; backend Node.js cần được triển khai trên một máy chủ riêng.

Khi triển khai backend, đặt `NODE_ENV=production`, cấu hình `HOST` và `PORT`,
sao lưu thư mục `data/`, rồi khởi động bằng `npm start`. Không dùng tài khoản
admin mặc định hoặc thông tin thanh toán mẫu trên môi trường công khai. Sau
khi deploy, smoke-test trang chủ, `GET /api/books`, đăng nhập, tạo đơn COD và
tra cứu đơn hàng; theo dõi log ít nhất 30 phút đầu.

Để rollback, dừng service, khôi phục tag ổn định gần nhất và bản sao lưu
`data/`, chạy lại `npm ci` rồi `npm start`. Kiểm tra lại các endpoint chính
trước khi mở traffic.

## API

## Quản lý khách hàng

Hướng dẫn schema, API, phân quyền, seed/migration, ví dụ request/response,
privacy và checklist kiểm thử nằm tại
[docs/CUSTOMER_MANAGEMENT.md](docs/CUSTOMER_MANAGEMENT.md). Thiết kế schema
quan hệ chi tiết được ghi tại [docs/crm-design.md](docs/crm-design.md).

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

- [docs/CUSTOMER_MANAGEMENT.md](docs/CUSTOMER_MANAGEMENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

## 10. Triển khai cloud

Mô hình triển khai gồm GitHub Pages (frontend), Render (Node.js API) và
Supabase PostgreSQL (database). Cấu hình Render nằm trong `render.yaml`;
backend sẽ dùng PostgreSQL khi có `DATABASE_URL` và tự tạo bảng JSONB
`booknest_data` khi khởi động. Nếu chạy local không có `DATABASE_URL`, dữ liệu
tiếp tục được lưu bằng các file JSON/JSONL.

1. Trong Render, cấu hình bí mật `DATABASE_URL`, `ADMIN_EMAIL` và
   `ADMIN_PASSWORD` (ít nhất 12 ký tự). Không dùng mật khẩu Supabase làm mật
   khẩu quản trị BookNest.
2. Đặt `CORS_ORIGINS=https://duongcongcao-0312.github.io` trên Render. Nếu dùng
   domain khác thì thay bằng origin chính xác, không gồm đường dẫn trang.
3. Workflow Pages mặc định trỏ tới `https://duannhom5-main.onrender.com`. Nếu
   backend có URL khác, đặt GitHub Actions Variable `API_BASE_URL`.
4. Đẩy thay đổi lên `main` để GitHub Actions triển khai frontend và Render tự
   build backend. Kiểm tra `https://<backend>/api/books`.

    subgraph DATA["03 · LỚP DỮ LIỆU"]
        direction LR
        USERS[("users.json<br/>tài khoản")]
        BOOKS[("books.json<br/>sách do quản trị thêm")]
        ORDERS[("orders.jsonl<br/>đơn hàng")]
        SERVICES[("service-requests.jsonl<br/>yêu cầu dịch vụ")]
        CATALOG["books-data.js<br/>danh mục mặc định"]
    end

    subgraph QUALITY["04 · CHẤT LƯỢNG VÀ TỰ ĐỘNG HÓA"]
        direction LR
        TESTS["Kiểm thử tự động<br/>tests/ · node:test"]
        CI["GitHub Actions<br/>kiểm thử · rà soát dependency"]
        PACKAGE["package.json<br/>npm start · npm test"]
        PACKAGE --> TESTS
        CI --> TESTS
    end

    CUSTOMER --> STORE
    CUSTOMER --> DETAIL
    ADMIN --> ADMIN_UI
    STORE <-->|"HTTP · HTTPS qua reverse proxy"| SERVER
    DETAIL <-->|"HTTP · HTTPS qua reverse proxy"| SERVER
    ADMIN_UI <-->|"HTTP · HTTPS qua reverse proxy"| SERVER
    REPOSITORY --> USERS
    REPOSITORY --> BOOKS
    REPOSITORY --> ORDERS
    REPOSITORY --> SERVICES
    API --> CATALOG

    classDef people fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-width:1px
    classDef client fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e,stroke-width:1px
    classDef app fill:#ede9fe,stroke:#7c3aed,color:#3b0764,stroke-width:1px
    classDef storage fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1px
    classDef quality fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1px
    class CUSTOMER,ADMIN people
    class STORE,DETAIL,ADMIN_UI client
    class SERVER,STATIC,API,AUTH app
    class BROWSER_DATA,SESSION,USERS,BOOKS,ORDERS,SERVICES storage
    class CATALOG app
    class TESTS,CI,PACKAGE quality
    style USER fill:#f8fafc,stroke:#cbd5e1
    style CLIENT fill:#f0f9ff,stroke:#7dd3fc
    style APP fill:#f5f3ff,stroke:#c4b5fd
    style DATA fill:#f0fdf4,stroke:#86efac
    style QUALITY fill:#fffbeb,stroke:#fcd34d
```

### Các lớp và trách nhiệm

| Lớp | Thành phần | Trách nhiệm |
| --- | --- | --- |
| Giao diện | Trang cửa hàng, trang chi tiết sách và cổng quản trị | Hiển thị nội dung, nhận thao tác người dùng và gọi REST API. |
| Ứng dụng | `server.js` | Chạy HTTP server, phục vụ tệp tĩnh, định tuyến API, kiểm tra dữ liệu và thực hiện các luồng nghiệp vụ. |
| Xác thực | `backend/auth.js` | Băm/kiểm tra mật khẩu bằng `scrypt`; tạo, xác thực và huỷ phiên đăng nhập. |
| Truy cập dữ liệu | `backend/db.js` | Đọc và ghi tài khoản, sách quản trị và yêu cầu dịch vụ; dữ liệu đơn hàng được ghi/đọc theo JSONL. |
| Dữ liệu | Thư mục `data/` và `books-data.js` | Lưu dữ liệu ứng dụng trên máy chủ và cung cấp danh mục sách mặc định. |
| Chất lượng | `tests/`, `.github/workflows/`, `package.json` | Chạy kiểm thử tự động và các bước kiểm tra dependency trong CI. |

### Luồng xử lý chính

1. Trình duyệt tải các trang tĩnh từ Node.js server; người dùng thao tác ở cửa
   hàng, trang sách hoặc cổng quản trị.
2. Khi cần dữ liệu hoặc cập nhật, frontend gọi REST API. Server kiểm tra request,
   xác thực phiên và quyền truy cập với các API được bảo vệ.
3. API thực hiện nghiệp vụ; nếu cần, đọc/ghi dữ liệu thông qua các thành phần
   tương ứng. Giá và dữ liệu đơn hàng được xử lý ở máy chủ, không lấy
   `localStorage` làm nguồn dữ liệu đáng tin cậy.
4. Server trả kết quả cho trình duyệt. Trạng thái phục vụ trải nghiệm người dùng
   (ví dụ giỏ hàng và yêu thích) được lưu trong `localStorage`.
5. Kiểm thử chạy bằng `node:test`; GitHub Actions thực thi kiểm thử và rà soát
   dependency khi có thay đổi phù hợp.

### Ranh giới lưu trữ và giới hạn hiện tại

- **Trên trình duyệt:** `localStorage` chứa trạng thái giao diện và token phiên.
- **Trong tiến trình Node.js:** phiên đăng nhập được lưu trong bộ nhớ, có hạn
  dùng 7 ngày; phiên sẽ mất khi tiến trình khởi động lại.
- **Trên máy chủ:** tài khoản, sách quản trị, đơn hàng và yêu cầu dịch vụ được
  lưu bằng tệp JSON/JSONL. Danh mục sách mặc định nằm trong `books-data.js`.
- **Vận hành:** ứng dụng hiện là một tiến trình Node.js, không có database,
  hàng đợi hay cache độc lập. Lưu trữ dạng file phù hợp cho demo/quy mô nhỏ,
  nhưng hạn chế giao dịch, mở rộng nhiều instance và phục hồi dữ liệu.

Khi phát triển thành dịch vụ thực tế, nên thay lưu trữ file bằng cơ sở dữ liệu
có giao dịch và sao lưu, chuyển phiên sang kho dùng chung nếu chạy nhiều
instance, đồng thời bổ sung giám sát và quy trình triển khai. Đây là hướng nâng
cấp đề xuất, không phải thành phần đã có trong phiên bản hiện tại.

## Yêu cầu phi chức năng

Dưới đây là các yêu cầu phi chức năng phù hợp với mức độ của dự án BookNest:

- Hiệu năng: trang chủ và danh sách sách cần tải nhanh trong môi trường local
  hoặc server vừa phải; số lượng dữ liệu mẫu nên giới hạn trong phạm vi hợp lý
  để giữ thời gian phản hồi thấp.
- Khả năng mở rộng: hệ thống nên dễ thêm thể loại sách, trường dữ liệu, API mới
  mà không cần sửa nhiều điểm trung tâm.
- Tính sẵn sàng: máy chủ cần chạy ổn định trong thời gian dài; khi lưu dữ liệu
  vào file cần tránh race condition khi có nhiều request đồng thời.
- Tính khả dụng trên thiết bị: giao diện cần tương thích với máy tính và điện
  thoại, giữ bố cục rõ ràng ở màn hình nhỏ.
- Khả năng bảo trì: code nên tách rõ phần view, API và dữ liệu; mỗi chức năng có
  cấu trúc mô-đun dễ kiểm tra và mở rộng.
- Độ tin cậy: cập nhật đơn hàng, thanh toán và kho hàng cần tránh trạng thái
  không nhất quán; mỗi thao tác quan trọng nên có kiểm tra xác thực và dữ liệu.
- Bảo mật dữ liệu: thông tin người dùng, đơn hàng và token phải được lưu và xử lý
  đúng cách, tránh rò rỉ hay lộ ra khi triển khai môi trường công cộng.
- Khả năng kiểm thử: API và luồng chính cần có bộ kiểm thử tự động để đảm bảo
  không phá vỡ chức năng khi phát triển thêm.

## Bảo mật của hệ thống

BookNest ở phiên bản demo hiện có một số biện pháp cơ bản, nhưng vẫn cần được
cải thiện trước khi vận hành thực tế:

- Mã hoá mật khẩu: mật khẩu cần được băm bằng thuật toán thích hợp như bcrypt
  hoặc Argon2 thay vì lưu ở dạng văn bản thuần.
- Quản lý phiên: token hoặc session nên có thời gian sống, có chữ ký và được
  lưu an toàn; không nên để token ở dạng dễ khai thác trên client.
- Xác thực và phân quyền: API quản trị chỉ được truy cập bởi người dùng có role
  quản trị; các route quan trọng phải kiểm tra quyền trước khi thực thi.
- Kiểm tra đầu vào: dữ liệu từ form, URL và request body cần được validate để
  tránh lỗi, tấn công injection hoặc payload bất thường.
- Giới hạn truy cập: nên ánh xạ `HOST` và `PORT`, đóng service trên localhost khi
  phát triển; không mở node server trực tiếp trên internet nếu chưa có HTTPS và
  quy trình bảo mật đầy đủ.
- Bảo vệ dữ liệu nhạy cảm: không lưu dữ liệu thật, mật khẩu, thông tin giao
  nhận hoặc token vào repository; các file JSON nên giữ riêng trong môi trường
  triển khai có phân quyền.
- HTTPS và bảo mật truyền tải: khi triển khai thực tế, bắt buộc dùng HTTPS để
  mã hoá dữ liệu giữa browser và server.
- Sao lưu và phục hồi: dữ liệu người dùng, đơn hàng và sách cần có sao lưu định
  kỳ và quy trình khôi phục sự cố.
- Rà soát dependency: dùng `npm audit` và cập nhật các gói liên quan nhằm giảm
  rủi ro lỗ hổng trong thư viện bên thứ ba.

Các nguyên tắc bảo mật khuyến nghị:

1. Không để tài khoản admin mặc định ở môi trường production.
2. Không công khai file dữ liệu nhạy cảm trên GitHub hoặc shared storage.
3. Giới hạn quyền truy cập file hệ thống và thư mục data theo user/service account.
4. Báo cáo và xử lý lỗi không lộ stack trace, password hay thông tin nhạy cảm.
5. Có nhật ký sự kiện (audit log) cho đăng nhập, cập nhật đơn hàng và thay đổi
   quyền quản trị.

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

## Google and Facebook registration

The registration form uses Firebase Authentication popups for Google and
Facebook. Set the Firebase web app values in `assets/firebase-config.js` from
Firebase Console > Project settings > Your apps. These browser configuration
values are public; never put a provider client secret in this file.

```sh
npm test
npm audit --omit=dev
```

GitHub Actions cũng cài các gói theo lockfile, chạy kiểm thử và kiểm tra lỗ
hổng dependency khi có push lên nhánh `main` hoặc pull request.

## Đơn hàng và API

Thiết kế lưu trữ hồ sơ khách hàng, schema CRM, quyền truy cập, bảo mật và lộ
trình migration được ghi tại [docs/crm-design.md](docs/crm-design.md).

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
| `PATCH` | `/api/auth/customer-info` | Người dùng | Lưu thông tin liên hệ vào tài khoản |
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
Enable Google and Facebook under Firebase Authentication > Sign-in method, add
`sachlatrithuc.com` under Authorized domains, and configure each provider's
OAuth app with Firebase's redirect URI shown in its provider settings. Serve the
site over HTTPS (or localhost while developing). The Facebook App ID and secret
belong only in Firebase Console.

Chỉ dùng file `.env` local để thử nghiệm; không commit connection string hay
mật khẩu. Giá trị nhạy cảm từng bị ghi vào `.env.example` đã phải được thay
đổi/thu hồi trước khi dùng dịch vụ. Các file dữ liệu JSON/JSONL cũ không tự
được import vào PostgreSQL. Phiên đăng nhập hiện lưu trong bộ nhớ backend nên
bị xóa khi tiến trình Render khởi động lại.
