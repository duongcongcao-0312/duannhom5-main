# Checklist vận hành production

Tài liệu này là checklist bằng chứng cho mỗi lần deploy Render. Không ghi
`DATABASE_URL`, mật khẩu, API key, webhook URL hoặc dữ liệu khách hàng vào
ticket, log hay repository. Chỉ ghi mã phiên chạy, thời điểm, trạng thái và
thời lượng.

## 1. PostgreSQL và Render

- [ ] Render service dùng Node.js 20 hoặc mới hơn và health check `/ready`.
- [ ] `DATABASE_URL` được nhập qua Environment/secret manager, không nằm trong
  blueprint, command line hoặc log.
- [ ] Database cùng region với web service nếu dùng Render Postgres; đã kiểm tra
  giới hạn kết nối/dung lượng và chính sách retention hiện tại của gói.
- [ ] `CORS_ORIGINS` chỉ chứa các origin frontend cần thiết, phân tách bằng dấu
  phẩy, không chứa path, wildcard hoặc credential.
- [ ] Ghi lại `deploy_id`, thời điểm UTC và kết quả `GET /health`, `GET /ready`.

## 2. Migration và deploy

1. Tạo provider snapshot/backup trước deploy và ghi `backup_id` (không ghi URL).
2. Xem danh sách migration trong `data/migrations/`; version phải tăng dần.
3. Render chạy `npm run migrate && npm start`. Migration dùng advisory lock,
   bảng `schema_migrations`, transaction riêng cho từng file và bỏ qua version
   đã áp dụng.
4. Kiểm tra log chỉ có `Applied database migration <filename>` và không có
   credential.
5. Sau deploy chạy `npm run smoke` với `SMOKE_BASE_URL` của service, rồi kiểm
   tra `/ready` lần nữa.
6. Nếu migration hoặc smoke fail: giữ service ở trạng thái không nhận traffic,
   khôi phục snapshot vào database cô lập trước; chỉ rollback ứng dụng khi
   migration tương thích ngược cho phép.

Không chạy migration bằng tay đồng thời với deploy. Không đánh dấu migration
đã chạy nếu chưa thấy bản ghi tương ứng trong `schema_migrations`.

## 3. API, CORS và auth/RBAC

- [ ] `npm run predeploy:check` pass; output không chứa secret.
- [ ] Preflight từ origin được phép trả `204`, có
  `Access-Control-Allow-Origin` đúng origin và không dùng wildcard.
- [ ] Preflight từ origin không được phép trả `403`.
- [ ] Anonymous request tới API admin trả `401`; user thường tới endpoint
  admin trả `403`.
- [ ] Admin/sales/support chỉ truy cập đúng permission; thử cả request thành
  công và bị từ chối, không dùng dữ liệu thật.
- [ ] Response lỗi có mã HTTP đúng và `X-Request-Id`; body không chứa stack,
  secret hoặc connection string.

## 4. Backup định kỳ và cảnh báo

- [ ] `npm run backup:schedule` chạy từ worker/job riêng hoặc scheduler được
  quản lý, không phụ thuộc web process.
- [ ] Backup được tạo ngoài `DATA_DIR`, verify manifest/checksum thành công và
  sao chép sang storage độc lập/mã hóa.
- [ ] PostgreSQL có backup/PITR của provider; archive `pg_dump` được verify bằng
  `pg_restore --list`.
- [ ] Retention đã kiểm tra: tối thiểu hai bản mới nhất và số ngày theo policy.
- [ ] Thử lỗi backup để xác nhận log `backup_failed` và webhook cảnh báo; log
  không lộ secret.

## 5. Restore drill

Ghi bằng chứng cho mỗi lần diễn tập:

| Trường | Giá trị |
| --- | --- |
| Thời điểm UTC | |
| `backup_id`/tên thư mục | |
| Môi trường cô lập | |
| Verify checksum/archive | pass/fail |
| Thời gian restore | |
| RPO đạt được | |
| RTO đạt được | |
| Smoke test sau restore | pass/fail |
| Người xác nhận và incident/ticket | |

File storage dùng `node scripts/backup.js restore <backup> <isolated-data> --confirm`.
PostgreSQL dùng `node scripts/backup.js restore-postgres <backup> --confirm` với
database đích cô lập. Không restore trực tiếp vào production trong diễn tập.

## Versioning và rollback

API tiếp tục dùng `/api`; thay đổi deploy hiện tại chỉ là migration nội bộ và
kiểm tra vận hành, không tạo version mới. Chỉ thêm `/api/v2` khi có thay đổi
request/response không tương thích; khi đó phải duy trì `/api` trong thời gian
deprecation đã thông báo và cập nhật OpenAPI/CI cùng release.
