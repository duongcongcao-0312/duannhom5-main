# CI gates trước deploy

Chi tiết các kiểm tra production và phần operator cần xác nhận: [Production configuration release gate](./production-configuration-release-gate.md).

BookNest dùng GitHub Actions để kiểm tra mọi thay đổi trước khi triển khai.

## Các kiểm tra bắt buộc

Workflow `BookNest CI` chạy trên mọi nhánh, pull request vào `main`, và được
gọi lại trước mỗi lần deploy staging, deploy GitHub Pages hoặc publish container.
Mọi luồng deploy đều chờ gate này thành công. Gate phải hoàn thành toàn bộ các
bước sau:

1. Cài dependency bằng `npm ci` theo `package-lock.json`.
2. Kiểm tra cú pháp JavaScript bằng `npm run check`.
3. Chạy `npm run predeploy:check` để kiểm tra credential production, origin CORS
   và version migration mà không in giá trị bí mật.
4. Chạy `npm run migrate` trên PostgreSQL service container để tạo schema cho
   integration test trước khi kiểm tra ứng dụng.
5. Chạy unit test, integration test và kiểm tra coverage tổng thể bằng
   `npm run test:coverage`. Gate yêu cầu ít nhất **70% line coverage, 65%
   branch coverage và 60% function coverage**; thiếu bất kỳ ngưỡng nào đều làm
   lệnh thất bại và chặn job CI. Báo cáo coverage dạng bảng được in trong log
   GitHub Actions; test output dạng `spec` cũng hiển thị rõ pass/fail. Báo cáo
   JUnit được tạo tại `test-results.xml` và LCOV tại `coverage/lcov.info`.
   CI tải cả hai lên artifact `test-reports` trong 14 ngày kể cả khi test hoặc
   coverage gate thất bại; mở trang workflow run để xem/tải báo cáo.
   Có thể chạy riêng từng nhóm để chẩn đoán, ví dụ:
   `npm run test:backend:auth`, `npm run test:backend:customer` hoặc
   `npm run test:postgres-ssl`.
   CI khởi động PostgreSQL 16 bằng service container và chạy
   `tests/postgres-integration.test.js` với database rỗng để kiểm tra khởi tạo
   schema, CRUD, rollback transaction và cleanup thật. Khi chạy local không có
   `DATABASE_URL`, test tích hợp này được skip; có thể chạy riêng bằng
   `DATABASE_URL=... npm run test:postgres-integration`.
6. Chạy `npm run test:coverage:business`, yêu cầu ít nhất **80% line coverage**
   trên phạm vi module nghiệp vụ/API được chốt: `server.js`,
   `backend/authorization.js`, `backend/business-constants.js`,
   `backend/coupons.js`, `backend/order-idempotency.js`,
   `backend/routes/auth.js`, `backend/routes/orders.js` và
   `backend/routes/payments.js`. Các persistence adapter vẫn được kiểm tra bằng
   unit/integration test và gate coverage tổng thể.
7. Build frontend tĩnh bằng `npm run build:pages`.
8. Kiểm tra toàn bộ dependency, bao gồm cả công cụ test, bằng `npm audit`.

Playwright E2E hiện chưa là CI gate: phần này đang tạm hoãn theo yêu cầu của
người dùng, và issue #121 chưa được xác nhận hoàn tất. Cấu hình hiện có yêu cầu
một PostgreSQL database local chỉ dành cho test qua `E2E_DATABASE_URL`; không
dùng database production. Trước khi bật lại, cần hoàn thiện và xác minh suite
trên database dùng một lần. Screenshot, video và trace hiện được tắt.

## Artifact và kết quả

- CI lưu site đã build theo commit trong artifact `booknest-site-<sha>` trong
  30 ngày. GitHub Pages tải đúng artifact này sau khi CI thành công, không build
  lại một bản khác.
- CI lưu metadata gồm repository, commit, ref, workflow run, event, phiên bản
  Node.js và thời điểm build trong artifact `build-metadata-<sha>` trong 90 ngày.
- Báo cáo test/coverage và E2E được lưu trong 14 ngày. Workflow summary ghi kết
  quả, revision và liên kết run; staging cũng ghi revision deploy và kết quả
  smoke check. GitHub Checks/notifications tiếp tục phản ánh trạng thái gate.
- Container release chỉ publish sau CI, tạo SBOM và provenance cùng image.

## Quy tắc deploy và secrets

- GitHub Pages gọi lại workflow CI và chỉ build/deploy khi job `ci-gate` thành
  công.
- Container cũng gọi lại workflow CI và chỉ publish image khi job `ci-gate`
  thành công; job publish cần quyền `packages: write` riêng và dùng environment
  `production`.
- Deploy staging chỉ bắt đầu sau `ci-gate`, dùng environment `staging`, triển
  khai đúng commit đã kiểm tra, đợi trạng thái Render, readiness và smoke check.
- GitHub Pages deploy artifact đã qua CI vào environment `production`.
- Nếu bất kỳ bước nào thất bại, job deploy/publish bị chặn bởi `needs` và không
  được chạy.
- Khi thêm kiểm tra mới, cần thêm vào `.github/workflows/ci.yml` để mọi luồng
  deploy tiếp tục dùng cùng một gate.

PR vào `main` chạy `ci-gate`; test fail hoặc coverage dưới ngưỡng làm check
này thất bại. Để GitHub chặn merge thực sự, maintainer cần bật branch
protection/ruleset cho `main` và yêu cầu check `ci-gate` (workflow `BookNest
CI`) thành công. Đây là cài đặt quyền trên GitHub, không thể áp dụng chỉ bằng
thay đổi trong repository.

Trong **Settings → Environments**, cấu hình `staging` và `production`; đặt
reviewer/approval gate và giới hạn branch/tag được phép deploy theo chính sách
phát hành. Đưa `RENDER_API_KEY` vào environment secrets `staging`; đặt
`STAGING_RENDER_SERVICE_ID` và `STAGING_BASE_URL` ở environment variables cùng
tên. Dùng environment secrets/variables thay vì repository-wide secrets để
giới hạn phạm vi truy cập. `GITHUB_TOKEN` được tạo tự động và quyền được cấp
theo từng job; không lưu token này thủ công.

GitHub Pages cần bật **Source: GitHub Actions**. Render staging cần một service
và database riêng, dùng Blueprint `render.staging.yaml`; không trỏ biến staging
vào tài nguyên production. Cấu hình giới hạn tag phát hành (ví dụ `v*.*.*`)
trong environment `production` để chỉ tag version mới có thể publish container.
