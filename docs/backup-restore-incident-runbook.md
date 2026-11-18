# Runbook backup, restore và ứng phó sự cố

Runbook này áp dụng cho BookNest khi chạy Node.js/Docker với file storage hoặc
PostgreSQL trên Render. Chỉ người vận hành được phân quyền mới được đọc backup:
`users.json` chứa thông tin tài khoản và dữ liệu có thể chứa thông tin cá nhân.
Không lưu backup hoặc secret trong repository.

## Mục tiêu khôi phục

| Thành phần | RPO mục tiêu | RTO mục tiêu | Mức phục vụ |
|---|---:|---:|---|
| PostgreSQL production | 15 phút | 60 phút | Ưu tiên phục hồi giao dịch |
| `/app/data` JSON/JSONL | 24 giờ | 30 phút | Dùng backup gần nhất |
| Email khôi phục mật khẩu | 4 giờ | 60 phút | Có thể tạm tắt luồng reset |

RPO/RTO là mục tiêu vận hành, không phải cam kết của nhà cung cấp. Đo thời gian
thực tế sau mỗi lần diễn tập và cập nhật bảng này khi có thay đổi hạ tầng.

## Lịch backup và lưu giữ

1. File storage: chạy `npm run backup:schedule`; mặc định chạy ngay khi khởi
   động, sau đó mỗi 24 giờ. Mặc định giữ 30 ngày và luôn giữ ít nhất hai bản.
   Sao chép bản backup đã verify sang storage ngoài máy chủ bằng kết nối mã hóa.
2. PostgreSQL: khi `DATABASE_URL` được cấu hình, cùng scheduler tự chạy
   `pg_dump` theo lịch và verify archive bằng `pg_restore --list`. Cần cài
   PostgreSQL client tương thích trên host/container, đồng thời bật thêm
   backup/PITR của nhà cung cấp database cho production.
3. Mỗi backup có manifest SHA-256, được verify ngay sau khi tạo; nếu cấu hình
   `BACKUP_ENCRYPTION_KEY`, nội dung file/database archive được mã hóa
   AES-256-GCM trước khi được giữ trong thư mục backup. Kết quả được ghi JSON
   Lines vào `BACKUP_LOG_FILE` (mặc định `<BACKUP_DIR>/backup.log`). Lỗi được
   ghi ra stderr và log; cấu hình webhook HTTPS để gửi cảnh báo.
4. Hàng tháng restore vào môi trường cô lập, chạy smoke test và ghi thời điểm,
   backup ID, RPO đạt được cùng thời gian restore vào ticket incident.

Các biến cấu hình:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Nguồn file JSON/JSONL. |
| `BACKUP_DIR` | `./backups` | Nơi tạo thư mục backup theo thời gian. |
| `BACKUP_INTERVAL_HOURS` | `24` | Chu kỳ, từ 1 đến 8760 giờ. |
| `BACKUP_RETENTION_DAYS` | `30` | Số ngày giữ; luôn giữ ít nhất hai bản mới nhất. |
| `BACKUP_LOG_FILE` | `<BACKUP_DIR>/backup.log` | Log kết quả dạng JSON Lines. |
| `BACKUP_STATUS_FILE` | `<DATA_DIR>/backup-status.json` | Trạng thái lần backup gần nhất cho dashboard. |
| `BACKUP_ALERT_WEBHOOK_URL` | Không cấu hình | Webhook HTTPS nhận sự kiện `backup_failed`; lưu URL trong secret manager. |
| `DATABASE_URL` | Không cấu hình | Nếu có, scheduler backup PostgreSQL thay vì file JSON/JSONL. Không log hoặc truyền URL trong đối số tiến trình. |
| `DATABASE_BACKUP_TIMEOUT_MS` | `1800000` | Timeout cho `pg_dump`/`pg_restore`; từ 1 đến 86400000 ms. |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | Tên executable trong `PATH` | Đường dẫn client PostgreSQL nếu không nằm trong `PATH`. |
| `BACKUP_ENCRYPTION_KEY` | Không cấu hình | Khóa AES-256-GCM dạng base64 của đúng 32 byte; chỉ đặt trong secret manager. Khi có khóa, backup mới được mã hóa. |
| `BACKUP_ENCRYPTION_REQUIRED` | `false` | Đặt `true` để từ chối tạo/verify/restore backup plaintext hoặc chạy khi thiếu khóa hợp lệ. |

Tạo khóa ngẫu nhiên một lần và lưu trực tiếp vào secret manager, không ghi vào
repository, file log hay tham số command line:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64') + '\n')"
```

Khi `BACKUP_ENCRYPTION_REQUIRED=true`, scheduler/CLI dừng với lỗi cấu hình nếu
không có khóa đúng định dạng. Mất khóa đồng nghĩa không thể verify hoặc restore
backup đã mã hóa; duy trì bản sao khóa theo quy trình quản lý secret độc lập.
Các envelope dùng AES-256-GCM để phát hiện sai khóa và dữ liệu bị sửa. Manifest
được xác thực bằng HMAC khi mã hóa được bật; manifest không chứa dữ liệu backup
hoặc khóa nhưng vẫn để lộ tên file, thời gian, kích thước và checksum.

`DATA_DIR` được đọc bởi script backup, không đổi đường dẫn lưu trữ của backend.
Runtime file adapter dùng `data/` trong repository/container (Docker image dùng
`/app/data`). Khi chạy backup ngoài container, đặt `DATA_DIR` trỏ đúng thư mục
runtime; khi chạy trong Docker, chạy script trong container hoặc bind-mount đúng
đường dẫn. Đừng coi backup thành công là bằng chứng đã sao lưu dữ liệu đang
được ứng dụng sử dụng nếu chưa đối chiếu hai đường dẫn.

`DATA_DIR` và `BACKUP_DIR` không được trùng hoặc lồng nhau. Để backup đúng
JSON/JSONL đang hoạt động, chuyển backend sang maintenance hoặc dừng ghi trong
thời gian sao lưu. Script kiểm tra dữ liệu không đổi trong lúc copy và từ chối
backup nếu phát hiện file bị cập nhật giữa chừng. PostgreSQL client nhận URL
qua biến môi trường tiến trình, không đưa credential vào command arguments hoặc
log; khóa mã hóa cũng không được truyền vào child-process arguments hoặc
`pg_dump`/`pg_restore` environment. Khi bật mã hóa, file backup được mã hóa
trước khi lưu trong thư mục đích; file tạm trong quá trình `pg_dump` chỉ có
quyền truy cập giới hạn. Khi không bật, hành vi plaintext cũ được giữ nguyên.
Giới hạn ACL/volume của backup và chỉ truyền bản sao ra storage độc lập qua
kết nối TLS; repository không tự tích hợp hoặc cấp storage off-site.

Giữ bộ lập lịch chạy bằng service manager để tự khởi động lại sau reboot/crash.
Ví dụ Linux systemd:

```ini
# /etc/systemd/system/booknest-backup.service
[Unit]
Description=BookNest scheduled file backup
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/booknest
EnvironmentFile=/etc/booknest/backup.env
ExecStart=/usr/bin/npm run backup:schedule
Restart=always
RestartSec=30
User=booknest

[Install]
WantedBy=multi-user.target
```

Giới hạn quyền đọc `/etc/booknest/backup.env` (ví dụ `chmod 600`), thư mục data,
backup và log. Trên Windows, tạo Scheduled Task chạy khi máy khởi động với
working directory repository và action `npm.cmd run backup:schedule`; bật
restart on failure, cấu hình biến môi trường cho account chạy task, và giới hạn
ACL của thư mục cấu hình/backup. Không đưa webhook URL hoặc credential vào tham
số command line.

Health/readiness kiểm tra bằng `npm run smoke`. Mặc định script kiểm tra
`/health`, `/ready`, trang chủ, books API và endpoint auth/admin yêu cầu đăng
nhập. Các endpoint auth/admin được kiểm tra bằng request chưa xác thực để
không tăng bộ đếm rate-limit đăng nhập/đăng ký. Có thể đặt `SMOKE_BASE_URL`,
`SMOKE_TIMEOUT_MS` (1–120000 ms) và
`SMOKE_ALERT_WEBHOOK_URL` HTTPS. Chạy lệnh này theo lịch qua monitoring provider
hoặc task scheduler; check lỗi trả exit code khác 0, log JSON Lines ra stdout/
stderr và gửi webhook nếu đã cấu hình.

## Dashboard và cảnh báo

Admin dashboard hiển thị chỉ số API 5 phút gần nhất, tỷ lệ lỗi 5xx, p95 latency,
trạng thái database, số kết nối PostgreSQL, webhook thanh toán và lần backup gần
nhất. API `/api/admin/monitoring` chỉ dành cho người có quyền `read:dashboard`;
request log chỉ ghi route đã chuẩn hóa, method, status, duration và request ID,
không ghi body, header xác thực hoặc query string.

Đặt `MONITORING_ALERT_WEBHOOK_URL` qua secret manager để nhận cảnh báo runtime.
Payload không chứa request body, thông tin khách hàng hoặc lỗi thô. Các ngưỡng
mặc định và người xử lý:

| Alert | Ngưỡng | Owner | Hướng xử lý ban đầu |
| --- | --- | --- | --- |
| API 5xx | 5 lỗi API trong 5 phút | Backend on-call | Dùng `requestId` tra log, kiểm tra `/ready` và database trước khi rollback. |
| Database | `/ready` trả 5xx hoặc health probe thất bại | Backend/database on-call | Kiểm tra connection limit, network/TLS và provider; không xóa hoặc seed lại dữ liệu. |
| Payment webhook | 3 lỗi 5xx hoặc 3 xung đột trong 5 phút | Payment on-call | Đối chiếu event ID/request ID với provider; không phát lại event xung đột thủ công. |
| Order idempotency | 3 response 409 trong 5 phút | Backend on-call | Kiểm tra retry cùng key và payload; giữ nguyên khóa, không tạo key mới để né conflict. |
| Backup | Bất kỳ `backup_failed` | Data/backup on-call | Kiểm tra `backup.log`, dung lượng/quyền và verify checksum; chạy lại sau khi khắc phục. |

`BACKUP_ALERT_WEBHOOK_URL` gửi cảnh báo backup thất bại ngay; trạng thái được
ghi nguyên tử vào `BACKUP_STATUS_FILE` (mặc định
`<DATA_DIR>/backup-status.json`) để dashboard đọc lần chạy gần nhất. Nếu
scheduler chạy ở worker riêng, worker và web service phải chia sẻ file này qua
storage bền vững; nếu không, dashboard sẽ hiển thị trạng thái `unknown` và cần
dùng webhook/provider log để giám sát backup.

Kiểm thử ngưỡng API/payment và database trong môi trường staging bằng payload
giả, xác nhận webhook nhận event đúng một lần trong thời gian cooldown 15 phút;
kiểm thử backup bằng `node --test tests/backup-runbook.test.js` với webhook
mock. Không cố ý làm lỗi hoặc gửi webhook giả trong production.

Load test đo thời gian phản hồi của health, catalog phân trang và order quote
trên local hoặc staging được allow-list; chạy bằng `npm run load-test` theo
hướng dẫn tại `docs/deployment.md`. Ghi p50/p95/p99 và error rate cùng thời
điểm, request count, concurrency, phiên bản deploy và environment. Không áp
ngưỡng hiệu năng từ local, không gửi tải vào production; CPU/RAM/database
metrics, ngưỡng cảnh báo và capacity phải được đo/duyệt trên staging. Hiện
chưa có bằng chứng provisioning staging, dashboard/alert verification, rollback
drill hoặc provider payment test; operator cần hoàn tất và đính kèm bằng chứng.

## File storage: backup và restore

Các file JSON được ghi qua file tạm rồi thay thế nguyên tử; các thao tác append
JSONL được tuần tự hóa theo từng file trong tiến trình. JSONL hỏng từng dòng
được cô lập khi đọc, nhưng JSON cấu trúc hỏng hoặc lỗi quyền đọc/ghi sẽ trả lỗi
explicit và không bị coi là dữ liệu rỗng. Vì vậy cần dừng backend trước khi
restore và luôn verify checksum sau restore.

Dừng ghi dữ liệu hoặc chuyển traffic sang maintenance trước khi sao chép để
tránh backup chứa JSONL đang được ghi dở:

```sh
node scripts/backup.js create ./backups/2026-11-02
node scripts/backup.js verify ./backups/2026-11-02
```

Trên Docker, đặt `DATA_DIR=/app/data` cho tiến trình backup hoặc chạy lệnh
trong container. Backup phải được sao chép sang storage ngoài máy chủ sau khi
verify.

Quy trình restore:

1. Ghi nhận incident và lưu bản sao hiện trạng trước khi sửa.
2. Dừng backend, xác định backup đã verify và thư mục dữ liệu đích.
3. Khôi phục có xác nhận rõ ràng:

```sh
node scripts/backup.js restore ./backups/2026-11-02 ./data --confirm
node scripts/backup.js verify ./backups/2026-11-02
```

4. Xác minh dữ liệu khôi phục trong thư mục cô lập, sau đó khởi động backend
   trỏ vào thư mục đó và chạy `npm run smoke` với `SMOKE_BASE_URL` trỏ tới môi
   trường kiểm thử; không diễn tập restore trên thư mục production.
5. Đối chiếu số bản ghi với manifest/backup, mở traffic và theo dõi log ít nhất
   một chu kỳ deploy.

Không dùng `--confirm` khi chỉ muốn verify. Restore không tự xóa tệp phát sinh
trong thư mục đích; nếu cần loại bỏ dữ liệu phát sinh, phải chụp lại hiện trạng
và thực hiện riêng theo phê duyệt incident.

## PostgreSQL/Render

### Backup

Đặt `DATABASE_URL` trong secret manager của service chạy scheduler, cùng
`BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS` và
`BACKUP_ALERT_WEBHOOK_URL`. Lệnh `npm run backup:schedule` tự chọn PostgreSQL
khi URL được cấu hình; cần có `pg_dump` và `pg_restore` trong PATH (hoặc đặt
`PG_DUMP_PATH`/`PG_RESTORE_PATH`). Không dán URL vào command line hay log.

Kiểm tra thủ công một bản đã tạo:

```sh
node scripts/backup.js verify ./backups/booknest-YYYYMMDDTHHMMSSmmmZ
```

Giữ PostgreSQL provider backup/PITR làm lớp bảo vệ độc lập. Khi bật mã hóa,
`database.dump` được mã hóa bằng AES-256-GCM và chỉ giải mã trong thư mục tạm
giới hạn quyền truy cập cho bước verify/restore. Repository không tự tạo worker
Render độc lập, remote storage, lịch backup ngoài tiến trình hoặc biên bản
restore drill; các bước đó cần operator cấu hình và xác minh riêng.

### Restore

1. Bật maintenance và chặn ghi; xác nhận backup timestamp đáp ứng RPO. Tạo
   database đích cô lập và đặt `DATABASE_URL` qua secret manager cho tiến trình
   khôi phục.
2. `restore-postgres` có tùy chọn `--clean --if-exists`; xác nhận đúng database
   đích vì dữ liệu/schema trùng có thể bị thay thế. Không dùng production làm
   môi trường diễn tập.
3. Verify rồi restore với cờ xác nhận bắt buộc:

```sh
node scripts/backup.js verify ./backups/booknest-YYYYMMDDTHHMMSSmmmZ
node scripts/backup.js restore-postgres ./backups/booknest-YYYYMMDDTHHMMSSmmmZ --confirm
```

4. Chạy migration còn thiếu bằng `npm run migrate` nếu release yêu cầu, đặt
   `SMOKE_BASE_URL` trỏ tới backend cô lập và chạy `npm run smoke`. Đối chiếu
   bản ghi/log rồi mới chuyển traffic. Không chạy migration ngược trên
   production nếu chưa có backup trước migration.

## Ma trận xử lý sự cố

### Database unavailable

1. Xác nhận phạm vi: kiểm tra health endpoint, log kết nối và trạng thái Render.
2. Không xóa hoặc re-seed dữ liệu để “thử sửa”. Giữ maintenance nếu retry gây
   ghi trùng.
3. Kiểm tra `DATABASE_URL`, network/allow-list, connection limit và chứng thư
   TLS. Khôi phục database/provider hoặc chuyển sang bản backup đã xác nhận.
4. Sau khi kết nối lại, chạy smoke test và đối chiếu giao dịch trong khoảng mất
   kết nối; ghi rõ dữ liệu cần nhập bù.

### Email unavailable

1. Kiểm tra `RESEND_API_KEY`/`RESEND_FROM` trước, sau đó SMTP và log provider.
2. Không báo “đã gửi” nếu provider trả lỗi. Giữ yêu cầu reset ở trạng thái lỗi,
   thông báo người dùng thử lại sau; không gửi token qua log/chat.
3. Khôi phục provider hoặc chuyển sang provider đã phê duyệt, gửi một email test
   đến hộp thư kiểm soát và kiểm tra domain.

### Disk full

1. Bật maintenance và kiểm tra `df -h`/dung lượng volume; không xóa dữ liệu
   production tùy tiện.
2. Di chuyển backup/log cũ đã được xác định sang storage lưu trữ, giải phóng
   dung lượng an toàn, rồi kiểm tra quyền ghi.
3. Kiểm tra JSON/JSONL có bị truncate không. Nếu có, giữ file lỗi, restore bản
   gần nhất và chạy verify trước khi mở traffic.

### Corrupted data

1. Dừng ghi, giữ nguyên file/database lỗi để điều tra và tạo snapshot hiện trạng.
2. Chạy `node scripts/backup.js verify <backup-dir>` hoặc kiểm tra checksum dump.
3. Restore bản gần nhất còn nguyên; không sửa trực tiếp file gốc bằng editor.
4. Chạy toàn bộ smoke test, đối chiếu record count và ghi nhận phần dữ liệu mất
   theo RPO. Mở traffic từng bước và theo dõi lỗi.

## Checklist đóng incident

- [ ] Đã ghi thời điểm phát hiện, người phụ trách, phạm vi và nguyên nhân.
- [ ] Đã lưu hiện trạng trước restore và xác nhận backup/checksum.
- [ ] RPO/RTO thực tế đã được tính và so với mục tiêu.
- [ ] API, admin login, đơn hàng, service request và email test đã đạt.
- [ ] Secret không xuất hiện trong log, ticket hoặc backup công khai.
- [ ] Đã ghi hành động phòng ngừa, người duyệt và thời điểm diễn tập tiếp theo.
