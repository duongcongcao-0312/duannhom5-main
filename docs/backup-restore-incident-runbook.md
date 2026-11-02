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

1. File storage: backup mỗi ngày và trước mỗi deploy/migration; giữ ít nhất 14
   bản ngày, trong đó có 1 bản ngoài máy chủ.
2. PostgreSQL: bật backup/PITR theo gói Render, kiểm tra bản backup gần nhất mỗi
   ngày; xuất một bản mã hóa trước migration.
3. Mỗi backup phải có checksum và được chạy verify ngay sau khi tạo. Hàng tháng
   restore vào môi trường cô lập và chạy smoke test.
4. Ghi lại thời điểm, người thực hiện, backup ID, RPO đạt được và thời gian
   restore trong ticket incident.

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

4. Khởi động backend, chạy `curl --fail http://127.0.0.1:8000/api/books` và
   `curl --fail http://127.0.0.1:8000/`, sau đó kiểm tra đăng nhập admin, đơn
   hàng và yêu cầu dịch vụ thử.
5. Đối chiếu số bản ghi với manifest/backup, mở traffic và theo dõi log ít nhất
   một chu kỳ deploy.

Không dùng `--confirm` khi chỉ muốn verify. Restore không tự xóa tệp phát sinh
trong thư mục đích; nếu cần loại bỏ dữ liệu phát sinh, phải chụp lại hiện trạng
và thực hiện riêng theo phê duyệt incident.

## PostgreSQL/Render

### Backup

Lấy `DATABASE_URL` từ secret manager, không ghi vào shell history hoặc log:

```sh
pg_dump --format=custom --no-owner --file=./backups/booknest-$(date +%Y%m%d).dump "$DATABASE_URL"
pg_restore --list ./backups/booknest-YYYYMMDD.dump > ./backups/booknest-YYYYMMDD.contents
```

Giữ file dump ở storage mã hóa, giới hạn quyền đọc, và kiểm tra file không rỗng.
Không chạy `pg_dump` khi chưa xác định đúng database production.

### Restore

1. Bật maintenance và chặn ghi; xác nhận backup timestamp đáp ứng RPO.
2. Tạo database đích rỗng hoặc clone riêng. Ưu tiên restore vào database cô lập
   để kiểm tra trước khi chuyển traffic.
3. Restore với `ON_ERROR_STOP`/exit code được kiểm tra:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" ./backups/booknest-YYYYMMDD.dump
```

4. Chạy migration còn thiếu bằng `npm run migrate` nếu release yêu cầu, rồi
   kiểm tra số bản ghi, API smoke test và log. Không chạy migration ngược trên
   database production nếu chưa có backup trước migration.

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
