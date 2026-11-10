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
   Sao chép bản backup đã verify sang storage ngoài máy chủ.
2. PostgreSQL: khi `DATABASE_URL` được cấu hình, cùng scheduler tự chạy
   `pg_dump` theo lịch và verify archive bằng `pg_restore --list`. Cần cài
   PostgreSQL client tương thích trên host/container, đồng thời bật thêm
   backup/PITR của nhà cung cấp database cho production.
3. Mỗi backup file có manifest SHA-256, được verify ngay sau khi tạo; kết quả
   được ghi JSON Lines vào `BACKUP_LOG_FILE` (mặc định
   `<BACKUP_DIR>/backup.log`). Lỗi được ghi ra stderr và log; cấu hình webhook
   HTTPS để gửi cảnh báo.
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
| `BACKUP_ALERT_WEBHOOK_URL` | Không cấu hình | Webhook HTTPS nhận sự kiện `backup_failed`; lưu URL trong secret manager. |
| `DATABASE_URL` | Không cấu hình | Nếu có, scheduler backup PostgreSQL thay vì file JSON/JSONL. Không log hoặc truyền URL trong đối số tiến trình. |
| `DATABASE_BACKUP_TIMEOUT_MS` | `1800000` | Timeout cho `pg_dump`/`pg_restore`; từ 1 đến 86400000 ms. |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | Tên executable trong `PATH` | Đường dẫn client PostgreSQL nếu không nằm trong `PATH`. |

`DATA_DIR` và `BACKUP_DIR` không được trùng hoặc lồng nhau. Để backup đúng
JSON/JSONL đang hoạt động, chuyển backend sang maintenance hoặc dừng ghi trong
thời gian sao lưu. Script kiểm tra dữ liệu không đổi trong lúc copy và từ chối
backup nếu phát hiện file bị cập nhật giữa chừng. PostgreSQL client nhận URL
qua biến môi trường tiến trình, không đưa credential vào command arguments hoặc
log. File backup có quyền truy cập giới hạn và không được mã hóa; đặt thư mục
trên volume mã hóa, hạn chế ACL và sao chép ra storage mã hóa ngoài máy chủ.

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

Trên Docker, đặt `DATA_DIR=/app/data` hoặc chạy lệnh trong container. Backup
phải được sao chép sang storage ngoài máy chủ sau khi verify.

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

Giữ PostgreSQL provider backup/PITR làm lớp bảo vệ độc lập. Archive PostgreSQL
chứa dữ liệu nhạy cảm; chỉ lưu trên volume mã hóa, giới hạn quyền đọc và kiểm
tra định kỳ bản sao ngoài máy chủ.

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
