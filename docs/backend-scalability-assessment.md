# Đánh giá khả năng mở rộng backend

Phạm vi: đánh giá mã nguồn tại thời điểm 2026-11-23 cho BN-137 / issue #343. Đây
là đánh giá kiến trúc tĩnh; chưa có số đo staging hoặc production trong tài liệu
này.

## Kết luận

Backend có đường chạy PostgreSQL và session dùng chung, nên có nền tảng để chạy
nhiều process cho dữ liệu chính. Tuy vậy, chưa có cơ sở để công bố một giới hạn
tải hay số instance an toàn: pool, bộ nhớ, CPU, database, storage và SLO của
môi trường triển khai cần được đo cùng nhau. Bài spike hiện tại chỉ phát tải tối
đa 20 request đồng thời trong một burst ngắn.

Scale nhiều instance chỉ an toàn khi mỗi trạng thái ghi còn lại trên filesystem
được chuyển sang kho dùng chung hoặc được đảm bảo chỉ có một writer. Nếu không,
các instance có thể nhìn thấy dữ liệu khác nhau hoặc ghi đè lẫn nhau.

## Trạng thái hiện tại và tác động scale-out

| Thành phần | Hiện trạng trong code | Hệ quả khi tăng tải / thêm instance |
| --- | --- | --- |
| HTTP backend | Node.js server; mỗi instance có event loop và bộ nhớ riêng. | Scale ngang tăng năng lực xử lý, nhưng không chia sẻ biến trong bộ nhớ. CPU-bound password hashing có thể làm chậm event loop. |
| Dữ liệu chính | `DATABASE_URL` chọn PostgreSQL; nếu không, database file JSON là đường fallback. Render từ chối khởi động khi thiếu `DATABASE_URL`. | PostgreSQL phù hợp cho nhiều instance hơn file store. File fallback không phải kho dữ liệu phân tán. |
| PostgreSQL pool | `pg.Pool`, mặc định `max=10`, idle 30s, lifetime 1800s; có thể đặt `PG_POOL_MAX`, timeout kết nối 5s và timeout truy vấn 10s. | Tổng kết nối tối đa xấp xỉ `số instance × PG_POOL_MAX`, cộng các worker/tiến trình khác. Phải nằm trong ngân sách kết nối của DB, có chừa headroom quản trị và migration. |
| Session | `SessionStore` dùng repository; production yêu cầu repository PostgreSQL dùng chung. Khi không có repository, `SessionStore` giữ session trong `Map` của tiến trình. | Local-memory session làm đăng nhập phụ thuộc instance và mất khi restart; không dùng được để scale ngang đáng tin cậy. |
| Catalog cache | Cache trong tiến trình, TTL mặc định 2 giây, có gộp các lần nạp đồng thời trong cùng instance. | Mỗi instance có cache riêng, tải miss có thể nhân theo số instance; cập nhật invalidation không lan sang instance khác. TTL ngắn hạn chế độ cũ nhưng không loại bỏ vấn đề đồng bộ. |
| File storage | Có các đường dẫn JSON/JSONL cho orders, addresses, audit và uploads dưới `data/`. Một số ghi file atomic, nhưng atomic rename không đồng bộ giữa nhiều máy. | Persistent disk cục bộ thường gắn với một instance; ephemeral disk có thể mất dữ liệu khi deploy/restart. Upload và file mode cần xác nhận ở nền tảng triển khai. |
| Hàng đợi ghi order | `enqueueOrderWrite` tuần tự hóa theo đường dẫn trong process và từ chối khi pending đạt 100. | Chỉ bảo vệ một process; không khóa xuyên instance. Một hàng đợi tuần tự cũng giới hạn throughput của đường ghi file. |
| Queue/background jobs | Không thấy broker queue phân tán trong luồng ứng dụng đã rà soát. | Tác vụ chạy trong process có thể chạy lặp hoặc mất khi instance dừng; tác vụ cần đảm bảo giao một lần phải có kho/worker dùng chung và idempotency. |
| Giới hạn API | Có request body/rate limits và timeout database; bài load test có trần 500 request, concurrency 20, timeout 60 giây. | Giới hạn bảo vệ tài nguyên nhưng không phải bằng chứng capacity hoặc mục tiêu latency. |
| Quan sát | Có metrics request trong bộ nhớ, p95, lỗi và cảnh báo; pool có sự kiện waiting-client. | Metrics trong bộ nhớ chỉ phản ánh instance hiện tại và cửa sổ lưu mẫu hữu hạn; cần dashboard tổng hợp theo instance và DB để chẩn đoán scale-out. |

## Điểm nghẽn và giới hạn chưa biết

1. **Kết nối database:** cấu hình pool nhân theo số instance. Cần lấy `max_connections`
   khả dụng từ nhà cung cấp DB, mức kết nối nền, số process và pool thực tế trước
   khi tăng instance hoặc `PG_POOL_MAX`.
2. **Truy vấn và transaction:** timeout chặn truy vấn kéo dài nhưng không cho biết
   query nào chiếm CPU/I/O. Dùng pool waiting clients, query latency và `EXPLAIN`
   trên staging để tìm bottleneck trước khi tăng pool.
3. **File writes và queue:** đường file và queue trong process không hỗ trợ ghi
   phối hợp đa instance. Phải xác nhận backend production dùng PostgreSQL cho mọi
   collection/session cần chia sẻ; kiểm kê audit, backup status, uploads và các
   tác vụ file còn lại.
4. **CPU event loop:** hash mật khẩu dùng `scryptSync`; thao tác này đồng bộ và
   có thể chặn event loop dưới tải đăng nhập. Đo event-loop lag và latency auth
   riêng trước khi thay thuật toán/triển khai worker.
5. **Storage/egress/chi phí:** repository không ghi nhận gói dịch vụ, hạn mức
   disk, bandwidth, giá instance hay giá DB. Không thể suy ra chi phí hoặc số
   người dùng từ mã nguồn.
6. **Mục tiêu tải:** chưa có p95, error-rate, tài nguyên, thời gian hồi phục hay
   workload mix được chủ dịch vụ thống nhất. Vì vậy chưa thể chứng nhận capacity
   đạt tiêu chí BN-08.

## Mục tiêu đo lường đề xuất

Trước khi benchmark, chủ dịch vụ cần chốt workload đại diện (tỷ lệ đọc catalog,
quote, auth, ghi đơn và admin), thời lượng steady-state, số user/request rate,
SLO p95/error-rate, giới hạn CPU/RAM/DB connection và thời gian phục hồi. Các
con số 40/4 → 200/20 → 40/4 trong `docs/load-testing.md` chỉ là profile burst
hiện có; không được coi là SLO hay cam kết capacity. Nếu chưa có dữ liệu kinh
doanh, dùng profile đó như bước kiểm tra an toàn ban đầu, rồi tăng tải theo nấc
trên staging cô lập.

## Lộ trình ưu tiên

| Ưu tiên | Hành động | Rủi ro / phụ thuộc | Cách xác minh |
| --- | --- | --- | --- |
| P0 | Chốt workload, SLO và ngân sách kết nối DB với chủ dịch vụ; ghi nhận cấu hình staging và giới hạn nền tảng. | Không có chủ sở hữu/metrics thì không thể đặt tiêu chí pass. | Có baseline và ngưỡng dừng/pass được phê duyệt, gồm p95, lỗi, CPU/RAM, pool waits và phục hồi. |
| P0 | Lập inventory mọi đường lưu file, upload, backup status, audit và xác nhận backend production dùng PostgreSQL cho dữ liệu/session cần chia sẻ. | Di chuyển sai có thể làm mất dữ liệu hoặc thay đổi retention. | Kiểm thử restart/deploy và hai instance; dữ liệu đọc/ghi nhất quán, upload truy cập được qua instance bất kỳ. |
| P1 | Chạy benchmark baseline/spike/recovery trên staging cô lập, theo dõi app + DB + pool + disk, lặp lại ở từng nấc concurrency. | Burst không mô phỏng steady-state; không chạy trên production. | Báo cáo theo run có commit/release, cấu hình, p50/p95/p99, lỗi, throughput, resource peak, pool waits và thời gian hồi phục. |
| P1 | Điều chỉnh `PG_POOL_MAX` dựa trên tổng số instance và ngân sách DB; ưu tiên cải thiện query/index nếu pool wait do query chậm. | Pool lớn có thể làm DB quá tải hơn; index tăng chi phí ghi/dung lượng. | So sánh cùng workload, xác nhận không vượt connection budget và p95/error-rate cải thiện. |
| P1 | Xử lý các trạng thái ghi cần đa instance: chuyển sang PostgreSQL/object storage và thay queue trong process bằng cơ chế dùng chung nếu có background work. | Cần migration, retry/idempotency, quyền truy cập và kế hoạch rollback. | Chạy song song nhiều instance, fault/restart drill, đối soát số bản ghi/file và không tạo side-effect lặp. |
| P2 | Xem xét cache chia sẻ hoặc TTL/invalidation rõ ràng, metrics tổng hợp và autoscaling sau khi có bottleneck evidence. | Cache phân tán tăng độ phức tạp và có nguy cơ dữ liệu cũ; autoscale làm pool nhân nhanh. | Kiểm tra freshness, hit rate, DB load, instance scaling và headroom kết nối dưới tải. |

## Thử nghiệm và tiêu chí hoàn tất

Chưa chạy thử nghiệm tải trong lần đánh giá này: cần endpoint staging được phép,
database cô lập và dashboard tài nguyên để tránh tác động môi trường thật. Runbook
hiện có ở [`load-testing.md`](load-testing.md) đã chặn production và mô tả profile
read-only. Sau khi chủ dịch vụ chốt SLO, chạy theo runbook, ghi kết quả tại đây
hoặc đính kèm báo cáo, rồi cập nhật kết luận capacity.

BN-08 chỉ có thể đánh dấu hoàn tất khi có cả mục tiêu tải đã thống nhất và kết
quả staging chứng minh các ngưỡng p95/error/resource/recovery đó được đáp ứng.
