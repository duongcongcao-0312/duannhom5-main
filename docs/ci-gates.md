# CI gates trước deploy

BookNest dùng GitHub Actions để kiểm tra mọi thay đổi trước khi triển khai.

## Các kiểm tra bắt buộc

Workflow `BookNest CI` chạy trên các nhánh khác `main` và trên pull request vào
`main`. Workflow gồm một gate duy nhất, phải hoàn thành thành công toàn bộ các
bước sau:

1. Cài dependency bằng `npm ci` theo `package-lock.json`.
2. Kiểm tra cú pháp JavaScript bằng `npm run check`.
3. Chạy unit test, integration test và kiểm tra coverage bằng
   `npm run test:coverage`. Gate yêu cầu ít nhất **60% line coverage, 60%
   branch coverage và 45% function coverage**; thiếu bất kỳ ngưỡng nào đều làm
   lệnh thất bại và chặn job CI. Báo cáo coverage dạng bảng được in trong log
   GitHub Actions; test output dạng `spec` cũng hiển thị rõ pass/fail. Báo cáo
   JUnit được tạo tại `test-results.xml` và LCOV tại `coverage/lcov.info`.
   CI tải cả hai lên artifact `test-reports` trong 14 ngày kể cả khi test hoặc
   coverage gate thất bại; mở trang workflow run để xem/tải báo cáo.
   Có thể chạy riêng từng nhóm để chẩn đoán, ví dụ:
   `npm run test:backend:auth`, `npm run test:backend:customer` hoặc
   `npm run test:postgres-ssl`.
4. Build frontend tĩnh bằng `npm run build:pages`.
5. Kiểm tra dependency có lỗ hổng production bằng `npm audit --omit=dev`.

## Quy tắc deploy

- GitHub Pages gọi lại workflow CI và chỉ build/deploy khi job `ci-gate` thành
  công.
- Container cũng gọi lại workflow CI và chỉ publish image khi job `ci-gate`
  thành công.
- Nếu bất kỳ bước nào thất bại, job deploy/publish bị chặn bởi `needs` và không
  được chạy.
- Khi thêm kiểm tra mới, cần thêm vào `.github/workflows/ci.yml` để mọi luồng
  deploy tiếp tục dùng cùng một gate.

PR vào `main` chạy `ci-gate`; test fail hoặc coverage dưới ngưỡng làm check
này thất bại. Để GitHub chặn merge thực sự, maintainer cần bật branch
protection/ruleset cho `main` và yêu cầu check `ci-gate` (workflow `BookNest
CI`) thành công. Đây là cài đặt quyền trên GitHub, không thể áp dụng chỉ bằng
thay đổi trong repository.
