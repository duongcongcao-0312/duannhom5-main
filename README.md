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
- [Backup và monitoring](#backup-và-monitoring)
- [CRM khách hàng](#crm-khách-hàng)
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
- Ưu đãi học sinh/sinh viên chỉ được áp dụng sau khi quản trị viên xác minh tài khoản.

## Công nghệ và kiến trúc

- **Frontend:** HTML, CSS và JavaScript thuần; có thể build thành static site cho GitHub Pages.
- **Backend:** Node.js HTTP server trong `server.js`, cung cấp static files và REST API.
- **Xác thực:** logic phiên và băm mật khẩu trong `backend/auth.js`.
- **Lưu trữ local/demo:** JSON và JSONL trong thư mục `data/`.
- **Lưu trữ:** JSON/JSONL cho local/demo; PostgreSQL/Supabase khi cấu hình `DATABASE_URL` (production nên dùng PostgreSQL).
- **Kiểm thử:** `node:test`.
- **Triển khai:** GitHub Pages cho frontend; Render hoặc máy chủ Node.js riêng cho backend.

Frontend không tự chạy API trên GitHub Pages. Khi deploy tách frontend và backend, frontend phải được cấu hình `API_BASE_URL` trỏ tới backend HTTPS và backend phải cho phép origin của frontend qua `CORS_ORIGINS`.

## Yêu cầu

- Node.js 20 trở lên.
- npm đi kèm Node.js.
- PostgreSQL dùng cho các luồng migration/seed; production nên dùng PostgreSQL để có lưu trữ bền vững và dùng chung giữa các instance.

Trong Windows PowerShell, nếu chính sách máy chặn `npm.ps1`, dùng `npm.cmd`
thay cho `npm` trong các lệnh bên dưới; không cần thay đổi execution policy.

## Cài đặt và chạy local

Yêu cầu Node.js 20 trở lên. Từ thư mục gốc của repository:

```sh
npm ci
```

Tạo file môi trường local (PowerShell):

```powershell
Copy-Item .env.example .env
```

Mở `.env`, đặt `ADMIN_EMAIL` và một `ADMIN_PASSWORD` riêng, tối thiểu 12 ký tự.
Không dùng lại mật khẩu của dịch vụ khác. Ứng dụng nạp `.env` bằng `dotenv`;
file này chỉ dành cho local và không được commit.

```sh
npm start
```

Mở storefront tại <http://127.0.0.1:8000>, cổng quản trị tại
<http://127.0.0.1:8000/admin.html>. Không có mật khẩu quản trị mặc định.
Không cấu hình `DATABASE_URL` thì local dùng file JSON/JSONL và phiên lưu trong
bộ nhớ của tiến trình.

## Cấu hình môi trường

`server.js` nạp `.env` qua `dotenv`. Trên macOS/Linux, tạo file local bằng:

```sh
cp .env.example .env
```

`API_BASE_URL` là biến build-time của `npm run build:pages`, không phải biến
runtime của backend; đặt trong environment của build/GitHub Actions nếu cần
đổi origin API.

Các biến thường dùng:

| Biến | Mục đích |
| --- | --- |
| `PORT` | Cổng HTTP của backend; local thường dùng `8000`. |
| `HOST` | Địa chỉ bind của backend; local nên dùng `127.0.0.1`, môi trường cloud thường dùng `0.0.0.0`. |
| `NODE_ENV` | Môi trường chạy, ví dụ `development` hoặc `production`. |
| `DATABASE_URL` | Connection string PostgreSQL; local lưu trong `.env` không commit, môi trường deploy lưu trong secret manager. |
| `DATABASE_SSL_CA_PATH` | Tùy chọn: đường dẫn tới CA certificate PostgreSQL tin cậy, ví dụ `/etc/secrets/supabase-ca.crt` trên Render. TLS vẫn xác minh chứng chỉ máy chủ. |
| `ADMIN_EMAIL` | Email quản trị do maintainer tự đặt trong môi trường deploy. |
| `ADMIN_PASSWORD` | Mật khẩu quản trị mạnh, tối thiểu 12 ký tự không phải khoảng trắng và không dùng lại mật khẩu dịch vụ database. |
| `CORS_ORIGINS` | Danh sách origin frontend được phép, phân tách bằng dấu phẩy. Không thêm path hoặc dấu `/` cuối origin. |
| `FIREBASE_API_KEY` | Firebase Web API key để backend xác minh ID Token social qua Firebase Identity Toolkit. |
| `SEPAY_API_KEY` | API key nhận webhook SePay; tối thiểu 16 ký tự và chỉ đặt trong secret manager. |
| `SEPAY_BANK_CODE` / `SEPAY_BANK_NAME` | Mã ngân hàng và tên hiển thị trong cấu hình thanh toán QR. Giá trị rỗng hiện dùng fallback demo từ `server.js`. |
| `SEPAY_ACCOUNT_NUMBER` / `SEPAY_ACCOUNT_NAME` | Tài khoản nhận chuyển khoản và tên hiển thị; endpoint cấu hình công khai các giá trị này. Phải đặt tài khoản đúng và kiểm tra `/api/payments/config` trước deploy. |
| `PAYMENT_WEBHOOK_SECRET` | Secret ngẫu nhiên tối thiểu 32 byte dùng xác minh webhook HMAC của BookNest; chỉ lưu trong secret manager. |
| `SESSION_TTL_MS` | Thời hạn phiên xác thực tính bằng mili giây; mặc định 8 giờ và phải lớn hơn 0. |
| `SESSION_REFRESH_TTL_MS` | Cửa sổ gia hạn phiên tính bằng mili giây; mặc định 30 ngày và phải lớn hơn 0. |
| `BACKUP_DIR` / `DATA_DIR` | Thư mục backup và nguồn file JSON/JSONL cho scripts backup. Runtime file storage mặc định dùng `data/` (Docker: `/app/data`); đặt `DATA_DIR` đúng đường dẫn khi backup, không để hai thư mục trùng hoặc lồng nhau. |
| `BACKUP_INTERVAL_HOURS` | Chu kỳ backup; mặc định 24 giờ, từ 1 đến 8760. |
| `BACKUP_RETENTION_DAYS` | Thời gian lưu backup; mặc định 30 ngày. Luôn giữ ít nhất hai bản gần nhất. |
| `BACKUP_LOG_FILE` | File log JSON Lines cho các lần backup, retention và lỗi. |
| `BACKUP_ALERT_TIMEOUT_MS` | Timeout webhook backup; mặc định 10 giây. |
| `BACKUP_ALERT_WEBHOOK_URL` | Webhook HTTPS tùy chọn để nhận cảnh báo khi backup thất bại; cấu hình trong secret manager. |
| `DATABASE_BACKUP_TIMEOUT_MS` | Timeout cho `pg_dump`/`pg_restore`; mặc định 30 phút, tối đa 24 giờ. |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | Đường dẫn executable PostgreSQL client nếu không có trong `PATH`. |
| `SMOKE_BASE_URL` / `SMOKE_TIMEOUT_MS` | URL backend và timeout cho smoke checks; mặc định `http://127.0.0.1:8000` và 5 giây. |
| `SMOKE_ALERT_WEBHOOK_URL` | Webhook HTTPS tùy chọn để cảnh báo khi health/readiness hoặc smoke check thất bại. |

**Không commit `.env`, connection string, mật khẩu, token hoặc dữ liệu khách hàng.** Nếu một secret đã từng xuất hiện trong repository, cần thu hồi và tạo secret mới; chỉ xóa khỏi file là chưa đủ.

Nếu PostgreSQL/Supabase báo lỗi TLS `SELF_SIGNED_CERT_IN_CHAIN`, tải CA certificate từ **Supabase → Project Settings → Database → SSL Configuration**. Trên Render, thêm certificate đó dưới **Environment → Secret Files** với tên `supabase-ca.crt`, rồi đặt `DATABASE_SSL_CA_PATH=/etc/secrets/supabase-ca.crt`. Không tắt xác minh chứng chỉ TLS.

Khi phát triển với PostgreSQL cục bộ, đặt `DATABASE_URL` trong `.env`, ví dụ
`postgresql://booknest:<password>@127.0.0.1:5432/booknest`. Backend chỉ tắt TLS
cho host loopback (`localhost`, `127.0.0.1`, `::1`); kết nối database từ xa
vẫn xác minh TLS như bình thường. Nếu database chưa có tài khoản, đặt
`ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env` để khởi tạo quản trị viên local.

## Các lệnh npm

| Lệnh | Mô tả |
| --- | --- |
| `npm start` | Khởi động Node.js server. |
| `npm run check` | Kiểm tra cú pháp JavaScript của server, client, scripts và tests. |
| `npm test` | Chạy toàn bộ test storefront và backend. |
| `npm run test:coverage` | Chạy test kèm báo cáo coverage của Node.js. |
| `npm run backup:schedule` | Tạo backup file hoặc PostgreSQL tùy `DATABASE_URL` ngay khi khởi động rồi lặp theo cấu hình. |
| `npm run smoke` | Kiểm tra health/readiness và các endpoint thiết yếu; trả mã lỗi khác 0 khi có check thất bại. |
| `npm run build:pages` | Tạo thư mục `dist/` cho frontend tĩnh. |
| `npm run migrate` | Chạy migration PostgreSQL khi có `DATABASE_URL`. |
| `npm run predeploy:check` | Kiểm tra điều kiện cấu hình và sẵn sàng trước deploy. |
| `npm run seed:customers` | Seed dữ liệu CRM mẫu cho development; không chạy trên production có dữ liệu thật. |
| `npm run audit` | Chạy `npm audit --omit=dev` cho dependency production. |

## API

Các endpoint chính hiện có:

| Phương thức | Đường dẫn | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/books` | Công khai | Lấy danh mục sách. |
| `GET` | `/api/coupons/:code` | Công khai | Kiểm tra mã ưu đãi. |
| `POST` | `/api/orders/quote` | Công khai | Tính báo giá theo catalog và ưu đãi do backend xác thực. |
| `POST` | `/api/orders` | Công khai | Tính lại giá, xác thực và lưu đơn; hỗ trợ `Idempotency-Key`. |
| `GET` | `/api/orders` | Người dùng | Tra cứu các đơn thuộc tài khoản đang đăng nhập. |
| `GET` | `/api/orders/:id/status` | Công khai | Tra cứu trạng thái đơn và thanh toán. |
| `GET` | `/api/orders/:id` | Chủ đơn/Quản trị | Tra cứu thông tin đơn theo quyền; dữ liệu công khai bị giới hạn. |
| `POST` | `/api/services` | Công khai | Gửi yêu cầu thuê, thu mua hoặc trao đổi sách. |
| `POST` | `/api/auth/register` | Công khai | Đăng ký tài khoản. |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập và nhận phiên xác thực. |
| `POST` | `/api/auth/password-reset` | Công khai | Yêu cầu email đặt lại mật khẩu nếu backend đã cấu hình email. |
| `POST` | `/api/auth/password-reset/confirm` | Công khai | Đặt mật khẩu mới bằng token dùng một lần. |
| `POST` | `/api/auth/social` | Firebase ID token | Đăng nhập Google/Facebook khi Firebase được cấu hình. |
| `GET` | `/api/auth/me` | Người dùng | Lấy thông tin tài khoản hiện tại. |
| `PATCH` | `/api/auth/customer-info` | Người dùng | Cập nhật thông tin liên hệ. |
| `POST` | `/api/auth/logout` | Người dùng | Đăng xuất. |
| `GET` | `/api/payments/config` | Công khai | Trả thông tin tài khoản ngân hàng hiển thị cho chuyển khoản QR. |
| `POST` | `/api/payments/sepay-webhook` | SePay API key | Nhận giao dịch đến và đối chiếu mã thanh toán, số tiền, tài khoản. |
| `POST` | `/api/payments/webhook` | HMAC signature | Nhận sự kiện theo hợp đồng webhook của BookNest. |
| `GET` / `POST` | `/api/customers` và `/api/admin/customers` | Quyền CRM | Tìm kiếm/phân trang hoặc tạo hồ sơ CRM; `/api/admin` là alias tương thích. |
| `GET` / `PUT` / `PATCH` / `DELETE` | `/api/customers/:id` và `/api/admin/customers/:id` | Quyền CRM | Xem, sửa, chuyển trạng thái hoặc xóa mềm hồ sơ. |
| `GET` / `POST` | `/api/customers/:id/interactions` và alias `/api/admin/...` | Quyền CRM | Xem hoặc ghi nhận lịch sử chăm sóc. |
| `PUT` / `PATCH` / `DELETE` | `/api/customers/:id/interactions/:interactionId` và alias `/api/admin/...` | Quyền CRM | Cập nhật hoặc xóa tương tác; chỉ admin được xóa. |
| `GET` | `/api/admin/stats` | Quản trị | Lấy thống kê. |
| `GET` | `/api/admin/orders` | Quản trị | Liệt kê đơn hàng. |
| `PATCH` | `/api/admin/orders/:id` | Quản trị | Cập nhật trạng thái đơn/thanh toán. |
| `GET` | `/api/admin/books` | `read:books` | Liệt kê sách trong cổng quản trị. |
| `POST` | `/api/admin/books` | Quản trị | Thêm sách. |
| `PUT` | `/api/admin/books/:id` | `write:books` | Cập nhật thông tin, thể loại và tồn kho; gửi `If-Match` với `updatedAt` để phát hiện cập nhật cũ. |
| `DELETE` | `/api/admin/books/:id` | Quản trị | Xóa sách. |
| `GET` | `/api/admin/coupons` | `read:coupons` | Liệt kê coupon và lượt sử dụng. |
| `POST` | `/api/admin/coupons` | `write:coupons` | Tạo coupon. |
| `PUT` / `PATCH` | `/api/admin/coupons/:code` | `write:coupons` | Cập nhật điều kiện hoặc bật/tắt coupon; bắt buộc gửi `If-Match` với `updatedAt` hiện tại. |
| `GET` | `/api/admin/services` | Quản trị | Liệt kê yêu cầu dịch vụ. |
| `PATCH` | `/api/admin/services/:id` | Quản trị | Cập nhật yêu cầu dịch vụ. |
| `GET` | `/api/admin/users` | Quản trị | Liệt kê người dùng. |
| `PATCH` | `/api/admin/users/:id` | `write:users` | Cập nhật trạng thái xác minh sinh viên. |
| `GET` | `/api/admin/staff` | `read:staff` | Liệt kê nhân viên và các quyền hiệu lực theo vai trò. |
| `POST` | `/api/admin/staff` | `write:staff` | Tạo tài khoản nhân viên với vai trò `sales` hoặc `support` và mật khẩu tối thiểu 12 ký tự. |
| `PATCH` | `/api/admin/staff/:id` | `write:staff` | Cập nhật tên/email/vai trò hoặc kích hoạt/vô hiệu hóa nhân viên; phiên hiện có bị thu hồi. |
| `GET` | `/api/admin/audit` | `read:users` | Đọc nhật ký kiểm toán quản trị, hỗ trợ `limit` và `offset`. |
| `GET` / `POST` | `/api/privacy/consents` | Người dùng | Đọc lịch sử hoặc ghi nhận bản ghi consent qua API. |
| `DELETE` | `/api/privacy/consents/:purpose` | Người dùng | Ghi nhận việc rút lại consent cho `order`, `service` hoặc `marketing`. |

Danh sách hỗ trợ phân trang và sắp xếp có whitelist; metadata nằm trong header
`X-Pagination`. Xem [tài liệu phân trang API](docs/api-pagination.md) và
[đặc tả OpenAPI](docs/openapi.json). Bản ghi consent hiện chưa được tích hợp
thành luồng xin phép tự động trong các form đặt hàng/dịch vụ; không xem API này
là bằng chứng các luồng đó đang cưỡng chế consent.

## Cổng quản trị

Mở `/admin.html` sau khi server khởi động. Tính năng gồm:

1. Xem thống kê doanh thu, đơn hàng, sách và thành viên.
2. Xem, lọc và cập nhật trạng thái đơn hàng.
3. Thêm, sửa, xóa sách tùy chỉnh; cập nhật tồn kho và thể loại của sách trong catalog. Sách mẫu không thể xóa.
4. Tạo/sửa coupon, cấu hình mức giảm, đơn tối thiểu, thời gian áp dụng, giới hạn lượt và bật/tắt.
5. Tiếp nhận và cập nhật yêu cầu thuê/thu mua/đổi sách.
6. Xem người dùng, vai trò và thông tin phân loại.
7. Tạo và cập nhật tên/email nhân viên vai trò `sales` hoặc `support`, xem quyền gắn với từng vai trò, đổi vai trò và kích hoạt/vô hiệu hóa tài khoản. Vô hiệu hóa chặn đăng nhập (bao gồm đăng nhập xã hội) và thu hồi phiên đang hoạt động. Chỉ tài khoản admin được quản lý nhân viên; API kiểm tra quyền ở backend và không cho phép gán vai trò admin qua màn hình này.

Thông tin quản trị phải được cung cấp qua `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong môi trường chạy. Nếu mã nguồn hoặc dữ liệu development có credential mẫu, credential đó chỉ dùng để kiểm thử local và phải được đổi trước khi chia sẻ hoặc deploy; README không cung cấp mật khẩu mặc định.

## Dữ liệu và lưu trữ

### Local/demo

- `localStorage` lưu giỏ hàng, yêu thích, coupon và yêu cầu dịch vụ nháp trên thiết bị.
- `sessionStorage` lưu bearer token, hồ sơ hiển thị và thông tin liên hệ tạm trên thiết bị; đây không phải kho sao lưu.
- Không có `DATABASE_URL`, backend local lưu dữ liệu trong các file JSON/JSONL dưới `data/` và giữ phiên trong bộ nhớ của tiến trình.
- `data/orders.jsonl` lưu mỗi đơn hàng trên một dòng JSON.
- `data/users.json`, `data/books.json` và các file dữ liệu liên quan lưu dữ liệu backend dạng file nếu không có database.
- Danh mục mặc định nằm trong `books-data.js`.
- Các thay đổi với sách mẫu được lưu như bản ghi đè trong `data/books.json` hoặc PostgreSQL; tồn kho ban đầu là 12 quyển nếu chưa được chỉnh sửa.
- Admin API chỉ chấp nhận thể loại có trong catalog và số tồn kho là số nguyên từ 0 đến 1.000.000.000. Tên sách trùng bị từ chối; cập nhật bằng `If-Match` cũ trả HTTP 409 để tránh ghi đè thay đổi mới.

Các file trong `data/` có thể chứa thông tin giao nhận hoặc dữ liệu cá nhân. Không commit dữ liệu thật và cần giới hạn quyền truy cập thư mục này.

### PostgreSQL/Supabase

`npm run migrate` áp dụng các migration PostgreSQL có thứ tự và ghi lịch sử trong `schema_migrations`; cần đặt `DATABASE_URL`. Migration 005 chuyển dữ liệu trong các collection JSONB cũ sang các bảng quan hệ cho người dùng, khách hàng, sản phẩm, đơn hàng, dòng đơn và yêu cầu dịch vụ; migration 006 tạo bảng coupon và giữ hai mã mẫu `BOOKNEST10`, `WELCOME5`; migration 007 bổ sung audit người cập nhật cho lịch sử tương tác CRM; migration 008 tạo bảng `privacy_consents` để ghi nhận và rút lại consent theo tài khoản, mục đích và phiên bản chính sách. Các collection cũ được giữ lại làm bản lưu trong giai đoạn chuyển đổi; runtime PostgreSQL đọc/ghi các bảng quan hệ. Sao lưu database trước khi nâng cấp; seed chỉ dành cho development. Xem [hướng dẫn CRM](docs/customer-crm.md) để biết cách kiểm tra và khôi phục.

Coupon được xác thực và tính giảm ở backend khi báo giá và tạo đơn. Mức giảm coupon cộng với ưu đãi tài khoản bị giới hạn tổng cộng 30%; đơn hàng phải đạt mức tối thiểu, coupon phải đang bật/trong thời hạn và chưa vượt giới hạn lượt. Lượt chỉ được ghi nhận khi đơn được tạo thành công. Local lưu coupon trong `data/coupons.json`; PostgreSQL cần chạy `npm run migrate` để áp dụng migration 006.

### Backup và monitoring

Health endpoint `/health` xác nhận tiến trình đang chạy; `/ready` kiểm tra khởi tạo persistence. `npm run smoke` kiểm tra thêm frontend, books API và các endpoint yêu cầu xác thực mà không tạo yêu cầu đăng nhập/đăng ký thất bại gây tăng bộ đếm rate-limit. Xem [runbook backup/restore và ứng phó sự cố](docs/backup-restore-incident-runbook.md) để cấu hình lịch backup, retention, cảnh báo, và diễn tập restore. PostgreSQL production nên giữ thêm backup/PITR độc lập của nhà cung cấp database.

Với PostgreSQL, endpoint tạo đơn lưu khóa `Idempotency-Key` và giữ tồn kho trong database dùng chung; đơn hàng và lượng tồn kho được cập nhật nguyên tử. Retry cùng nội dung trả lại đơn đã tạo, còn tái sử dụng khóa với payload khác trả HTTP 409. Cần chạy `npm run migrate` để cài các migration trước khi triển khai các instance mới.

Phiên đăng nhập có thời hạn mặc định 8 giờ (`SESSION_TTL_MS`); cửa sổ gia hạn
mặc định 30 ngày (`SESSION_REFRESH_TTL_MS`). Khi có `DATABASE_URL`, phiên được
lưu trong bảng PostgreSQL dùng chung `auth_sessions`, nên nhiều instance có
thể xác thực cùng phiên và phiên không mất khi backend khởi động lại. Token
bearer được lưu trong `sessionStorage`; ứng dụng không dùng cookie xác thực.
Production cần PostgreSQL để dùng session store bền vững.

Webhook thanh toán `POST /api/payments/webhook` chấp nhận JSON sự kiện có `id`, `orderId`, `status` (`succeeded`, `failed`, `pending`, `cancelled`), `amount`, `currency: "VND"` và `occurredAt`. Gửi `X-BookNest-Signature: sha256=<hex>` là HMAC-SHA256 của **raw request body**, dùng `PAYMENT_WEBHOOK_SECRET`; secret phải dài ít nhất 32 byte. Sự kiện chỉ áp dụng cho đơn chuyển khoản có đúng tổng tiền. PostgreSQL ghi nhận event ID và cập nhật trạng thái đơn trong cùng transaction; retry trùng được xác nhận mà không cập nhật lần hai, ID trùng payload khác bị từ chối, và event cũ hơn không ghi đè trạng thái mới. Trạng thái `paid` không bị sự kiện thất bại/hủy đến sau đảo ngược. Cổng thanh toán cần ánh xạ chữ ký và trạng thái nhà cung cấp vào hợp đồng này; endpoint chưa thực hiện gọi thu tiền tới một nhà cung cấp cụ thể.

Đăng nhập giới hạn 5 lần thử cho mỗi địa chỉ IP trong cửa sổ 15 phút; đăng nhập thành công sẽ xóa bộ đếm. Các thông tin đăng nhập sai và email không tồn tại cùng trả về HTTP 401 với thông báo chung. Khi vượt giới hạn, API trả về HTTP 429.

## Kiểm thử

```sh
npm test
```

Trước khi phát hành nên chạy:

```sh
npm ci
npm run check
npm test
npm run build:pages
npm run audit
```

## Triển khai

### Frontend trên GitHub Pages

1. Chạy `npm run build:pages`.
2. Workflow GitHub Actions deploy thư mục `dist/`.
3. Build script dùng `API_BASE_URL` (mặc định là URL backend trong
   `assets/api-config.js`); đặt biến này trong GitHub Actions nếu backend dùng
   URL khác.
4. Đảm bảo frontend gọi backend qua HTTPS.
5. Để bật khôi phục mật khẩu, cấu hình `PUBLIC_APP_URL` theo đúng URL storefront
   (bao gồm đường dẫn GitHub Pages nếu có) và thông tin nhà cung cấp email trên
   backend. Khuyến nghị dùng Resend qua HTTPS: `RESEND_API_KEY` và `RESEND_FROM`
   (địa chỉ gửi phải xác minh domain). Xem [docs/deployment.md](docs/deployment.md).

### Tài liệu API

Đặc tả OpenAPI 3.1 dùng được với Swagger UI/Editor nằm tại
[docs/openapi.json](docs/openapi.json).

Khách hàng cần có họ tên, email hợp lệ và số điện thoại từ 8 đến 15 chữ số.
Email và số điện thoại không được trùng với khách hàng đang hoạt động. Xoá
khách hàng chỉ đặt `deletedAt`, giữ nguyên dữ liệu trong kho lưu trữ và ẩn
khách hàng khỏi danh sách; thông tin đã xoá không còn giữ chỗ email hoặc số
điện thoại. Trạng thái `new → lead → customer` chỉ được chuyển tiến từng bước,
không thể bỏ qua hoặc quay lui. Các thao tác tạo/cập nhật/xoá ghi `created_by` và `updated_by` theo
ID người dùng của phiên xác thực. Đăng ký công khai luôn tạo tài khoản `user`;
chỉ quy trình cấp quyền đáng tin cậy mới được gán vai trò `admin`, `sales` hoặc
`support`.

### CRM khách hàng

Hướng dẫn schema PostgreSQL, migration/seed, ví dụ request/response API và
quyền riêng tư nằm trong [docs/customer-crm.md](docs/customer-crm.md). Runtime
dùng adapter PostgreSQL khi có `DATABASE_URL`; nếu không, local/demo dùng file
JSON/JSONL. Migration chỉ áp dụng schema, không tự chuyển dữ liệu file sang
PostgreSQL.

### Backend trên Render

File `render.yaml` định nghĩa service Node.js, chạy `npm ci`, sau đó
`npm run predeploy:check && npm run migrate && npm start`; health check readiness
là `/ready`. Liveness dùng `/health`; smoke test sau deploy chạy bằng
`npm run smoke`. Cấu hình các giá trị nhạy cảm trong Render Environment/Secret Variables:

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `FIREBASE_API_KEY` nếu bật đăng nhập social.
- `SEPAY_API_KEY` nếu nhận webhook SePay.
- `PAYMENT_WEBHOOK_SECRET` nếu nhận webhook HMAC của BookNest.

Đặt `HOST=0.0.0.0` trên Render và cấu hình `CORS_ORIGINS` đúng origin của GitHub Pages hoặc domain frontend. Không dùng mật khẩu Supabase làm mật khẩu quản trị BookNest.

Để cấu hình QR chuyển khoản, đặt `SEPAY_BANK_CODE`, `SEPAY_BANK_NAME`,
`SEPAY_ACCOUNT_NUMBER` và `SEPAY_ACCOUNT_NAME`. Lưu ý server hiện có giá trị
fallback demo nên biến rỗng không tắt QR; phải thay bằng tài khoản nhận tiền
đúng và kiểm tra kết quả trước khi deploy. Endpoint công khai
`GET /api/payments/config` trả thông tin tài khoản để frontend hiển thị QR
qua VietQR; đây không phải bộ xử lý thanh toán độc lập. Với webhook, cấu hình
`SEPAY_API_KEY` trong cổng SePay và gửi `Authorization: Apikey <key>` tới
`POST /api/payments/sepay-webhook`. Handler đối chiếu mã `BN` của đơn, tài
khoản nhận và số tiền chính xác; PostgreSQL bắt buộc. Không đặt API key trong
frontend. Webhook HMAC `POST /api/payments/webhook` là hợp đồng riêng của
BookNest, không tự động tương thích với payload/chữ ký của SePay.

Sau khi deploy, kiểm tra tối thiểu:

- Trang chủ và file tĩnh.
- `GET /api/books`.
- Đăng ký/đăng nhập.
- Tạo đơn COD ở môi trường test.
- Tra cứu đơn hàng.
- Quyền truy cập các endpoint quản trị.

Sao lưu dữ liệu trước khi nâng cấp hoặc rollback. GitHub Pages chỉ phục vụ frontend tĩnh và không chạy được Node.js API.

### Production và Docker

Hướng dẫn chạy container, lưu trữ dữ liệu bền vững, sao lưu và smoke-test có
trong [docs/deployment.md](docs/deployment.md). Workflow build và publish
container lên GitHub Container Registry khi push tag phiên bản `v*`; maintainer
cần tạo tag và cấu hình quyền package. Production cần `ADMIN_EMAIL` hợp lệ và
`ADMIN_PASSWORD` tối thiểu 12 ký tự không phải khoảng trắng được cấp qua secret manager.

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

Đăng ký và đặt lại mật khẩu yêu cầu 12–128 ký tự, không chỉ có khoảng trắng;
mật khẩu được giữ nguyên và không bị cắt khoảng trắng trước khi băm. Endpoint
đăng ký giới hạn 5 yêu cầu cho mỗi địa chỉ IP trong 15 phút và dùng bộ đếm trong
bộ nhớ của từng tiến trình Node.js. Khi chạy nhiều instance hoặc sau proxy, cần
cấu hình giới hạn tương ứng ở gateway/kho dùng chung; server không tin cậy các
header IP do client tự gửi.

### Đăng ký Google/Facebook

Nếu bật Firebase Authentication, cấu hình Google/Facebook provider và
Authorized domains trong Firebase Console. Frontend dùng các giá trị Web app
công khai trong `assets/firebase-config.js`; backend cần `FIREBASE_API_KEY` để
xác minh Firebase ID token. Giới hạn key theo API/referrer phù hợp trong Google
Cloud Console. Không đặt service-account private key, Facebook App Secret
hoặc credential riêng tư trong frontend. Website production phải dùng HTTPS;
localhost chỉ dành cho development.

Social login chỉ chấp nhận email đã được Firebase xác minh và provider Google/Facebook. Email trùng với tài khoản mật khẩu không tự động liên kết: người dùng cần đăng nhập bằng tài khoản hiện tại rồi gọi `POST /api/auth/social/link` với session bearer token, Firebase `idToken` và mật khẩu để xác thực lại. Gọi `POST /api/auth/social/unlink` với session token, `provider` (`google.com` hoặc `facebook.com`) và mật khẩu để tách provider. Tài khoản social-only cần đặt mật khẩu qua quy trình khôi phục email trước khi liên kết hoặc tách provider.

Các tài khoản social cũ vẫn giữ provider ID đã lưu và có thể đăng nhập bằng đúng provider ID đó. Không có migration tự động thay đổi liên kết cũ; trước khi gỡ liên kết đã tồn tại, cần kiểm tra thủ công các tài khoản có `authProvider`/`providerId` hoặc `socialAccounts` trong kho dữ liệu.

## Cấu trúc dự án

```text
.
├── assets/                 # Tài nguyên tĩnh và cấu hình frontend public
├── backend/                # Xác thực và truy cập dữ liệu backend
│   ├── auth.js
│   └── db.js
├── data/                   # Dữ liệu local; không commit dữ liệu thật
├── docs/                   # API, kiến trúc, triển khai và runbook
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
├── privacy.html            # Thông tin xử lý dữ liệu
├── package.json
└── README.md
```

## Tài liệu tham khảo

- [Kiến trúc hệ thống](ARCHITECTURE.md)
- [Hướng dẫn CRM hiện hành](docs/customer-crm.md)
- [Thiết kế CRM](docs/crm-design.md)
- [Triển khai](docs/deployment.md)
- [Checklist production](docs/production-readiness-checklist.md)
- [Runbook backup, restore và sự cố](docs/backup-restore-incident-runbook.md)
- [OpenAPI](docs/openapi.json)
- [CI gates](docs/ci-gates.md)
- [Chính sách quyền riêng tư](privacy.html)
- [Lịch sử thay đổi](CHANGELOG.md)

## Đóng góp

1. Tạo branch cho thay đổi.
2. Chạy `npm test` và các kiểm tra phù hợp.
3. Không commit `.env`, secret hoặc dữ liệu thật.
4. Mô tả rõ thay đổi và ảnh hưởng tới cấu hình/deploy trong pull request.
5. Dùng mẫu PR trong [.github/pull_request_template.md](.github/pull_request_template.md) và tuân thủ quy trình review được mô tả trong [CONTRIBUTING.md](CONTRIBUTING.md).
6. Đảm bảo comment/review feedback được xử lý rõ ràng trước khi merge.

Thông tin đóng góp của thành viên nên được đối chiếu từ commit, issue và pull request thực tế thay vì suy diễn chức danh.
