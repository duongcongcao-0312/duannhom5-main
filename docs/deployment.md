# Triển khai BookNest

## Yêu cầu

- Node.js 20 trở lên hoặc Docker Engine hỗ trợ image Linux.
- Một volume `/app/data` có quyền ghi khi chạy file storage; triển khai
  PostgreSQL dùng database quản lý và không cần volume này cho dữ liệu ứng dụng.
- HTTPS tại reverse proxy khi phục vụ qua mạng công cộng.

Trong Windows PowerShell, dùng `npm.cmd` nếu `npm.ps1` bị chặn bởi execution
policy; không cần hạ policy của máy.

## Chạy trực tiếp bằng Node.js

```sh
npm ci --omit=dev
HOST=127.0.0.1 PORT=8000 npm start
```

Đặt `HOST=0.0.0.0` chỉ khi tiến trình nằm trong mạng/container được kiểm soát;
không expose cổng ứng dụng trực tiếp ra Internet. Cấu hình TLS và giới hạn truy
cập tại reverse proxy.

Ở production, cấp `ADMIN_EMAIL` hợp lệ và `ADMIN_PASSWORD` tối thiểu 12 ký tự không phải khoảng trắng
qua secret manager trước khi tạo server. Có thể đặt thêm `ADMIN_NAME`. Server từ
chối khởi động production nếu thiếu email/mật khẩu hợp lệ; tài khoản demo chỉ
được seed trong môi trường không phải production.

Khi dùng Render Postgres, ưu tiên internal database URL của cùng region. Backend
dùng TLS và chỉ bỏ xác thực chứng thư cho hostname nội bộ Render (không có dấu
chấm); các hostname database bên ngoài vẫn xác thực chứng thư TLS.

Blueprint `render.yaml` chạy `npm run predeploy:check && npm run migrate &&
npm start`, vì vậy kiểm tra cấu hình và migration hoàn tất trước khi web server
nhận traffic. Hãy tạo backup/snapshot ở provider trước khi deploy, sau đó kiểm
tra `/ready` và chạy smoke test sau deploy. Checklist bằng
chứng không chứa secret nằm tại
[production-readiness-checklist.md](./production-readiness-checklist.md).

Nếu deploy lỗi, ghi lại deploy ID và giữ log; không xóa dữ liệu hay tự chạy
migration ngược. Chỉ rollback ứng dụng về deploy trước nếu migration vừa áp
dụng tương thích ngược với phiên bản đó. Nếu không chắc chắn, giữ backend ở
maintenance và triển khai bản sửa tương thích tiến; chỉ khôi phục database từ
snapshot sau khi xác nhận phạm vi mất dữ liệu và đích khôi phục. Thực hiện theo
[runbook backup/restore](./backup-restore-incident-runbook.md), rồi chạy smoke
test trước khi mở traffic.

Để bật khôi phục mật khẩu, cấu hình các biến sau trên backend:

- `PUBLIC_APP_URL`: URL đầy đủ của storefront, bao gồm đường dẫn nếu website
  được phục vụ trong thư mục con (ví dụ `https://example.com/booknest/`).
- `SMTP_HOST`, `SMTP_PORT` và `SMTP_FROM`: máy chủ SMTP, cổng (587 mặc định)
  và địa chỉ gửi thư.
- `SMTP_USER` và `SMTP_PASSWORD`: thông tin xác thực SMTP nếu máy chủ yêu cầu.
- Khuyến nghị dùng API email qua HTTPS: cấu hình `RESEND_API_KEY` và
  `RESEND_FROM` (địa chỉ gửi đã xác minh trong Resend). Khi các biến này có
  giá trị, backend ưu tiên Resend thay vì SMTP.
- Mỗi yêu cầu Resend có timeout 10 giây và tối đa 3 lần thử với backoff tăng
  dần cho lỗi mạng, HTTP 429 và lỗi HTTP 5xx. Kết nối PostgreSQL có timeout 5
  giây; truy vấn được giới hạn ở 10 giây.

Liên kết khôi phục có hiệu lực một giờ, chỉ dùng được một lần; sau khi đổi mật
khẩu, các phiên đăng nhập hiện có bị thu hồi. Nếu chưa cấu hình email hoặc URL
website, API khôi phục trả lỗi cấu hình thay vì thông báo đã gửi email.
Blueprint `render.yaml` khai báo sẵn các biến này và URL GitHub Pages. Trên
Render, hãy nhập `RESEND_API_KEY` và `RESEND_FROM` vào Environment, xác minh
domain gửi thư với Resend, rồi redeploy. API HTTPS không phụ thuộc kết nối
SMTP. Có thể dùng SMTP thay thế bằng cách cấu hình các biến `SMTP_*`. Không đưa
API key hoặc mật khẩu SMTP vào repository. Nếu gửi thư vẫn thất bại, kiểm tra
log dịch vụ Render để xem phản hồi lỗi từ nhà cung cấp.

## PostgreSQL connection pool

The `pg` pool is bounded per process: the defaults are at most 10 connections,
a 5 second acquire timeout, 30 second idle timeout, and 30 minute connection
lifetime. Set `PG_POOL_MAX`, `PG_POOL_IDLE_TIMEOUT_MS`, and
`PG_POOL_MAX_LIFETIME_SECONDS` to positive integers to adjust these values.
Budget runtime connections as `PG_POOL_MAX × maximum application instances`,
then reserve database capacity for migrations, backups, and other clients. For
example, three instances at the default pool size can open up to 30 connections.
`/ready` reports `active`, `idle`, `waiting`, and `total` for this process pool;
it does not include other processes. A `database_pool_waiting_clients` alert is
sent when requests are queued for a pool connection. Monitor it with
`database_unavailable` and adjust pool size within the database connection
limit, or reduce load if waiting persists.

## Firebase Authentication

1. Tạo Firebase project/Web app và bật Google hoặc Facebook trong
   **Authentication > Sign-in method**.
2. Thêm chính xác domain frontend vào **Authorized domains**. Production phải
   chạy qua HTTPS.
3. Frontend configuration (`apiKey`, `authDomain`, `projectId`, `appId`) nằm
   trong `assets/firebase-config.js` và được đóng gói vào static site; các giá
   trị này là public. Hạn chế Web API key theo API/referrer trong Google Cloud
   Console.
4. Đặt `FIREBASE_API_KEY` trên backend để máy chủ xác minh Firebase ID token.
   Không đặt service-account private key hoặc Facebook App Secret ở frontend
   hay trong Git.
5. Đăng nhập social dùng `POST /api/auth/social`; liên kết/tách provider yêu
   cầu bearer session và xác thực lại theo hợp đồng trong `docs/openapi.json`.

Nếu Firebase chưa cấu hình hoặc chưa được backend xác minh, không dùng luồng
đăng nhập social. Backend hiện xác minh token bằng Firebase Identity Toolkit
API key; không giả định service-account/Admin SDK đã được cài đặt.

## Thanh toán QR và webhook SePay

QR transfer hiển thị thông tin do `GET /api/payments/config` trả về:
`SEPAY_BANK_CODE`, `SEPAY_BANK_NAME`, `SEPAY_ACCOUNT_NUMBER` và
`SEPAY_ACCOUNT_NAME`. Frontend tạo ảnh QR qua dịch vụ VietQR bên ngoài; thông
tin ngân hàng, số tiền và mã chuyển khoản đơn được gửi trong URL ảnh. Cấu hình
đúng tài khoản nhận tiền trước khi deploy. Hiện server có fallback demo cho mã
ngân hàng/số tài khoản, vì vậy để trống biến môi trường không tắt QR. Kiểm tra
response `/api/payments/config` xác nhận đúng tài khoản trước khi public luồng
chuyển khoản. QR và tạo đơn không tự xác nhận tiền đã vào tài khoản.

Để nhận thông báo giao dịch:

1. Đặt `SEPAY_API_KEY` (ít nhất 16 ký tự) trong Render Environment/secret
   manager và cấu hình đúng endpoint webhook ở SePay:
   `https://<api-origin>/api/payments/sepay-webhook`.
2. SePay phải gửi JSON và header `Authorization: Apikey <SEPAY_API_KEY>`.
3. Handler chỉ đánh dấu đơn chuyển khoản là đã trả khi tìm được mã `BN` theo
   dạng `BN` cộng 12 ký tự hex trong nội dung giao dịch, phương thức đơn là
   chuyển khoản, số tài khoản khớp và số tiền bằng chính xác tổng đơn. Giao
   dịch khác sẽ được trả lời thành công nhưng bị bỏ qua; PostgreSQL bắt buộc
   để chống xử lý lặp.
4. Dùng đơn và tài khoản thử nghiệm để xác nhận callback, log, trạng thái đơn
   và xử lý callback lặp trước khi bật cho người dùng.

Không ghi API key vào URL, ticket hoặc log. `POST /api/payments/webhook` là
endpoint HMAC riêng của BookNest, cần `PAYMENT_WEBHOOK_SECRET` tối thiểu 32
byte và chữ ký trên raw body; đây không phải endpoint SePay và không gọi API
để thu tiền. Chưa bật webhook hoặc chưa xác minh giao dịch thực tế thì không
đưa ra thông báo rằng thanh toán đã được xử lý tự động.

## Chạy bằng Docker

Để chạy backend local bằng Docker Compose:

```powershell
Copy-Item .env.example .env
```

Mở `.env`, đặt `ADMIN_EMAIL` và `ADMIN_PASSWORD` (ít nhất 12 ký tự), sau đó chạy:

```sh
docker compose up --build -d
docker compose ps
```

Truy cập `http://localhost:8000`; xem log bằng `docker compose logs -f backend`
và dừng bằng `docker compose down`. Cổng host mặc định là `8000`; có thể đổi
bằng biến `HOST_PORT` trong `.env`. Compose local chạy chế độ development, dùng
kho dữ liệu dạng file được lưu trong volume `backend-data`, và chỉ bind cổng
trên loopback của máy.

Nếu chạy riêng frontend bằng VS Code Live Server hoặc Vite, dùng cổng mặc định
`5500` hoặc `5173`; frontend local sẽ tự gọi API tại `http://localhost:8000`
hoặc `http://127.0.0.1:8000`. Cách đơn giản nhất vẫn là mở trực tiếp
`http://localhost:8000`.

Không commit `.env` hoặc đưa mật khẩu/API key vào repository. Cấu hình Compose
này dành cho local development; production cần PostgreSQL, `DATABASE_URL`,
migration trước khi khởi động, và các biến bí mật được cấp qua secret manager.
Không expose cổng backend trực tiếp ra Internet; dùng HTTPS và reverse proxy
khi triển khai công khai.

Image xuất bản từ GitHub Actions có tên
`ghcr.io/duongcongcao-0312/duannhom5-main:<tag>`. Workflow chạy khi push tag
`v*`; maintainer cần tạo tag và cấu hình quyền/package visibility trên GitHub.

## Dữ liệu và tài khoản

Khi dùng file storage, BookNest lưu tài khoản, khách hàng CRM, sách quản trị,
đơn hàng và yêu cầu dịch vụ dưới `data/` (trong Docker là `/app/data`); gắn
volume bền vững trước khi dùng chế độ này. Khi có `DATABASE_URL`, runtime dùng
PostgreSQL và `render.yaml` chạy migration trước khi khởi động web server. Sao
lưu database/volume trước khi nâng phiên bản và thử khôi phục định kỳ.

Rate limit production dùng bảng PostgreSQL chia sẻ giữa các instance. Cấu hình
`RATE_LIMIT_HMAC_KEY` bằng secret ngẫu nhiên dài tối thiểu 32 byte; không ghi
giá trị này vào blueprint, log hoặc repository. Bucket chỉ lưu HMAC, không lưu
IP hay email gốc. Server production từ chối khởi động nếu thiếu secret này; khóa
fallback chỉ dùng cho môi trường không production.
`RATE_LIMIT_TRUSTED_PROXY_HOPS` mặc định là `0`, tức chỉ dùng
địa chỉ socket và bỏ qua `X-Forwarded-For`. Chỉ đặt số hop sau khi xác minh
chuỗi proxy thực tế; khi đặt lớn hơn `0`, khai báo các địa chỉ IP peer chính xác
của proxy trong `RATE_LIMIT_TRUSTED_PROXY_IPS`. Server chỉ đọc
`X-Forwarded-For` nếu peer socket nằm trong allowlist này; proxy biên vẫn phải
loại bỏ header forwarding do client tự gửi. Khi PostgreSQL rate-limit không khả dụng, endpoint được bảo vệ trả
`503` thay vì bỏ qua giới hạn; khi vượt hạn trả `429` cùng `Retry-After`.

Quy trình backup, restore và ứng phó sự cố chi tiết nằm trong
[runbook backup/restore](./backup-restore-incident-runbook.md). Dùng
`node scripts/backup.js verify` sau mỗi lần tạo backup và trước khi restore.

Không có tài khoản admin hoặc mật khẩu mặc định. Cấu hình `ADMIN_EMAIL` và
`ADMIN_PASSWORD` (tối thiểu 12 ký tự không phải khoảng trắng) trước khi tạo quyền quản trị; production
bắt buộc có credentials hợp lệ ngay từ lần khởi động đầu. Tài khoản admin mặc
định cũ được hạ quyền và mật khẩu bị vô hiệu hóa khi khởi tạo dữ liệu.
Phiên đăng nhập lưu trong bộ nhớ sẽ bị vô hiệu khi tiến trình khởi động lại.

## Kiểm tra sau deploy

```sh
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/ready
npm run smoke
```

`npm run smoke` ghi từng kết quả dưới dạng JSON, kiểm tra liveness/readiness,
frontend, books API, login failure và register validation. Hai kiểm tra auth cuối
cố ý dùng dữ liệu không hợp lệ nên không tạo tài khoản hoặc phiên trong
production. Có thể chạy với backend từ xa bằng `SMOKE_BASE_URL=https://api.example.com npm run smoke`.

API đặt hàng hỗ trợ retry an toàn bằng header `Idempotency-Key` (8-128 ký tự,
chỉ gồm chữ, số, dấu gạch ngang, gạch dưới, dấu chấm hoặc dấu hai chấm).
Client phải giữ nguyên khóa này khi retry sau timeout; server sẽ trả lại đơn
đã tạo thay vì ghi thêm một đơn mới. Giao diện checkout tự giữ khóa cho đến
khi đơn được xác nhận thành công.

Sau đó kiểm tra thủ công đăng nhập quản trị bằng tài khoản test riêng, tải
dashboard và một luồng mua hàng trong môi trường staging. Theo dõi log/container,
latency và dung lượng volume; không dùng tài khoản hoặc dữ liệu khách hàng thật
cho smoke test. Quy trình giám sát, rollback và thời gian quan sát sau deploy
phụ thuộc nền tảng vận hành.

## Kiểm thử tải không phá hủy

`npm run load-test` mặc định chỉ kết nối `http://127.0.0.1:8000`; chạy backend
local trước khi gọi. Kịch bản chỉ gọi `GET /health`, `GET /api/books` có phân
trang và `POST /api/orders/quote` (chỉ tính toán, không tạo đơn). Mặc định chạy
20 request, concurrency 4, timeout 5 giây. Kết quả JSON ghi p50/p95/p99 latency,
error rate, số lượng theo status và lỗi; script không đặt ngưỡng pass/fail về
hiệu năng. Kết quả local không đại diện cho capacity của Render/PostgreSQL.

Có thể giới hạn rõ request và thời gian bằng biến môi trường:

```powershell
$env:LOAD_TEST_REQUESTS = "20"
$env:LOAD_TEST_CONCURRENCY = "4"
$env:LOAD_TEST_TIMEOUT_MS = "5000"
npm.cmd run load-test
```

Chỉ cho phép host staging đã chỉ định chính xác, không dùng hostname production:

```powershell
$env:LOAD_TEST_BASE_URL = "https://staging.example.test"
$env:LOAD_TEST_ALLOW_STAGING = "true"
$env:LOAD_TEST_STAGING_HOSTS = "staging.example.test"
npm.cmd run load-test
```

Mọi host từ xa đều bị từ chối nếu không bật opt-in staging và khớp chính xác
danh sách trên. Giới hạn tối đa là 500 request, concurrency 20 và timeout
60 giây. Không chạy load test trên production. Đo CPU, RAM, PostgreSQL, capacity
thực tế, dashboard/cảnh báo và rollback drill cần staging riêng và bằng chứng
do operator xác nhận.

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
