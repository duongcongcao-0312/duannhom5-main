# Triển khai BookNest

Quy ước SemVer, tạo tag, release artifact, promotion, hotfix và thu hồi release
được mô tả trong [quy trình phát hành](./release-process.md).

## Tự động triển khai staging

Staging dùng Blueprint riêng tại `render.staging.yaml`, với `APP_ENV=staging`,
`EXPECTED_DATABASE_NAME=booknest_staging`, migration trước khi server nhận traffic
và health check `/ready`. Tạo staging service và PostgreSQL riêng trong Render;
không kết nối staging vào database, payment, email hoặc credentials production.

Để bật workflow `.github/workflows/staging.yml`:

1. Tạo Render API key chỉ có quyền deploy service staging và lưu thành GitHub
   Actions secret `RENDER_API_KEY`. Lấy service ID của `duannhom5-staging` và
   lưu thành repository variable `STAGING_RENDER_SERVICE_ID`.
2. Thêm GitHub Actions repository variable `STAGING_BASE_URL` là URL HTTPS của
   staging service (không có thông tin đăng nhập trong URL). Tắt auto-deploy
   theo commit trên Render; workflow sẽ yêu cầu deploy đúng SHA của commit vừa
   push lên `staging`.
3. Cấu hình service bằng database staging riêng, `DATABASE_URL` và
   `EXPECTED_DATABASE_NAME=booknest_staging`, cùng admin, rate-limit, email,
   payment và webhook secrets chỉ dùng cho staging. Dùng dữ liệu tổng hợp hoặc
   đã ẩn danh; không sao chép dữ liệu khách hàng thật.
4. Merge/cherry-pick commit đã chọn vào nhánh `staging`. Push nhánh này hoặc chạy
   workflow thủ công sẽ gọi Render deploy hook. Render chạy
   `predeploy:check`, migration và server startup theo thứ tự trong
   `startCommand`; workflow chờ Render xác nhận deploy SHA đó ở trạng thái live,
   đối chiếu commit SHA, chờ `/ready`, rồi chạy `scripts/smoke-test.js`. Kết quả,
   revision và liên kết workflow được ghi trong Actions run summary.

Workflow triển khai commit SHA cụ thể được push lên nhánh `staging`; kiểm tra
workflow thành công và smoke checks trước khi promote cùng commit sang
production. Nếu workflow
thất bại, xem Render deploy logs và Actions summary, giữ production nguyên trạng,
rồi sửa lỗi. Sau khi đã kích hoạt deploy, workflow tự ghi nhận deploy live
trước đó và gọi Render rollback nếu deploy, readiness hoặc smoke check thất bại;
Actions summary ghi deploy ID và commit đã khôi phục. Deploy đầu tiên không có
bản trước để khôi phục. Nếu rollback tự động không thành công, dùng deploy
trước đó trong Render Dashboard. Chỉ rollback sau khi xác nhận migration mới
tương thích ngược. Không tự chạy migration ngược. Nếu schema không tương thích,
triển khai forward-fix hoặc làm theo
[runbook backup/restore](./backup-restore-incident-runbook.md).

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

## Custom domain

Repo hiện triển khai storefront bằng GitHub Pages và API bằng Render. Không có tên
domain đã đăng ký nào được lưu trong repo; domain thực tế phải được chọn/đăng ký
trong tài khoản quản lý DNS rồi mới điền vào cấu hình dưới đây. Không đưa domain
placeholder vào production.

### Storefront

1. Thêm GitHub Actions repository variable `SITE_URL` với URL HTTPS chuẩn, ví dụ
   `https://shop.example.com/`. Nếu dùng GitHub Pages ở domain gốc, build tự thêm
   file `CNAME`; URL có đường dẫn vẫn dùng được cho GitHub Pages mặc định.
2. Trong Settings → Pages đặt cùng custom domain và bật Enforce HTTPS sau khi
   chứng chỉ được cấp. Tại nhà cung cấp DNS, thêm đúng bản ghi A/AAAA cho apex hoặc
   CNAME cho subdomain theo hướng dẫn GitHub Pages hiện hành. Không tạo đồng thời
   các bản ghi xung đột cho cùng hostname.
3. Chờ DNS cập nhật, xác nhận domain trong GitHub Pages, mở cả HTTP và HTTPS để
   kiểm tra HTTPS/redirect, rồi kiểm tra canonical, Open Graph, `/robots.txt` và
   `/sitemap.xml`. Build cũng cập nhật các URL SEO từ `SITE_URL`.

### API, CORS và tích hợp

1. Nếu có custom API hostname, gắn hostname đó vào Render service trong Dashboard
   và tạo bản ghi DNS mà Render chỉ định. Chờ trạng thái verified và TLS ready;
   API phải trả HTTPS trước khi chuyển frontend sang hostname mới.
2. Đặt GitHub Actions variable `API_BASE_URL` bằng origin API HTTPS, không có path,
   ví dụ `https://api.example.com`. Đặt Render `CORS_ORIGINS` chính xác bằng origin
   storefront, không có path hoặc dấu `/` cuối. Đặt `PUBLIC_APP_URL` bằng URL
   storefront đầy đủ, thường là `https://shop.example.com/`.
3. Cập nhật allowlist/authorized domains trong Firebase và URL redirect/callback
   của từng nhà cung cấp thanh toán, email hoặc đăng nhập nếu các tích hợp đó đang
   bật. Payment webhook vẫn phải trỏ tới endpoint API HTTPS của môi trường tương
   ứng; không dùng callback production cho staging.
4. Sau khi deploy, kiểm tra `/health` và `/ready`, đăng nhập, khôi phục mật khẩu,
   luồng thanh toán/callback bằng giao dịch thử, CORS từ browser và redirect HTTP
   sang HTTPS. Lưu chủ sở hữu tài khoản registrar, DNS, GitHub Pages, Render và
   ngày gia hạn trong kho quản lý vận hành có kiểm soát; bật tự động gia hạn nếu
   registrar hỗ trợ, đặt nhắc hạn và kiểm tra DNS/TLS định kỳ. TLS của hosting
   được nhà cung cấp cấp/gia hạn theo trạng thái dịch vụ; quyền sở hữu domain và
   việc gia hạn đăng ký domain vẫn do chủ tài khoản registrar quản lý.

Build GitHub Pages quét toàn bộ HTML, CSS, JavaScript, JSON, XML và SVG sẽ phát
hành, đồng thời từ chối artifact nếu tìm thấy URL `http://`. Kiểm tra này ngăn
tài nguyên hỗn hợp đã khai báo trong bundle; sau deploy vẫn cần kiểm tra trang
thực tế trong browser vì URL có thể được tạo động từ dữ liệu hoặc cấu hình dịch
vụ bên ngoài. Backend gửi HSTS trong production khi request đến qua TLS hoặc
qua reverse proxy HTTPS; probe nội bộ HTTP tiếp tục hoạt động và không nhận
HSTS. Redirect HTTP và chứng chỉ TLS được cấu hình tại GitHub Pages/Render hoặc
reverse proxy, không tại cổng HTTP nội bộ của Node.js.

## Overload handling

HTTP parsing is bounded by a 10 second header timeout and a 30 second request
body timeout. The server accepts at most 100 in-flight requests by default;
excess requests receive HTTP 503 with `Retry-After: 1`. File and order write
queues hold at most 100 operations per target and reject further writes with a
retryable 503. SMTP uses 5 second connection/greeting timeouts and a 10 second
socket timeout. Resend retries reuse one idempotency key for the email request.

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

Để chạy stack phát triển local bằng Docker Compose (Docker Engine và Compose plugin v2):

```powershell
docker compose up --build -d
docker compose ps
```

Compose khởi chạy PostgreSQL riêng trong network nội bộ, đợi database healthy,
chạy service `migrate`, rồi mới khởi chạy backend. Cấu hình dùng database và
credential development cố định, chỉ dành cho stack local; không có `env_file`
và không đọc secrets production từ `.env`. Cổng backend mặc định bind vào
loopback `127.0.0.1:8000`; đổi cổng host bằng biến `HOST_PORT` trong file
`.env` hoặc trong shell. Không dùng credential local này bên ngoài stack phát triển.

Kiểm tra trạng thái và log:

```powershell
docker compose ps
docker compose logs -f db migrate backend
Invoke-RestMethod http://127.0.0.1:8000/health
```

Migration tự chạy khi `docker compose up` tạo/cập nhật stack. Có thể xem trước
kế hoạch migration mà không thay đổi schema:

```powershell
docker compose run --rm --no-deps migrate node scripts/migrate.js --dry-run
```

Để chạy lại migration sau khi cập nhật code:

```powershell
docker compose up --build -d migrate
docker compose up -d backend
```

`docker compose down` dừng và xóa container/network nhưng giữ database và dữ
liệu trong named volumes. Chỉ khi muốn xóa hoàn toàn dữ liệu development và
khởi tạo như máy mới, dùng `docker compose down -v`; thao tác này xóa vĩnh viễn
database và dữ liệu file trong hai volume local.

Image dùng Node.js 22 Alpine, cài dependency production bằng `npm ci` từ lockfile
trong stage riêng, chạy với user `node` và có health check trên `/health`. Build
context loại `.env*`, dữ liệu runtime, test, tài liệu và dependency cục bộ; chỉ
các migration được đóng gói. Compose bật filesystem chỉ đọc, bỏ Linux capabilities
và giữ dữ liệu ở volume riêng. Không truyền secret bằng `ARG` hoặc `ENV` lúc build.

Truy cập `http://localhost:8000`; dừng bằng `docker compose down`. Nếu chạy riêng
frontend bằng VS Code Live Server hoặc Vite, dùng cổng mặc định `5500` hoặc
`5173`; frontend local sẽ gọi API tại `http://localhost:8000` hoặc
`http://127.0.0.1:8000`.

Compose này dành cho local development. Production cần PostgreSQL phù hợp,
`DATABASE_URL`, migration trước khi khởi động, và secrets được cấp qua secret
manager. Không expose cổng backend trực tiếp ra Internet; dùng HTTPS và reverse
proxy khi triển khai công khai.
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

### Global API rate limit

All `/api/*` requests except CORS preflight `OPTIONS` use a shared per-client limit of 300 requests per 15 minutes by default. Configure `API_RATE_LIMIT` and `API_RATE_WINDOW_MS` (milliseconds) to tune it. Endpoint-specific limits for authentication, orders, and sensitive operations still apply.

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
