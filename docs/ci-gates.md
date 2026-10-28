# CI gates trước deploy

BookNest dùng GitHub Actions để kiểm tra mọi thay đổi trước khi triển khai.

## Các kiểm tra bắt buộc

Workflow `BookNest CI` chạy trên các nhánh khác `main` và trên pull request vào
`main`. Workflow gồm một gate duy nhất, phải hoàn thành thành công toàn bộ các
bước sau:

1. Cài dependency bằng `npm ci` theo `package-lock.json`.
2. Kiểm tra cú pháp JavaScript bằng `npm run check`.
3. Chạy unit test và integration test theo các nhóm độc lập bằng
   `npm run test:coverage`. Có thể chạy riêng từng nhóm để chẩn đoán, ví dụ:
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

Để biến gate thành điều kiện bắt buộc khi merge, maintainer cần bật branch
protection/ruleset cho `main` trên GitHub và yêu cầu check `ci-gate` (workflow
`BookNest CI`) thành công.
