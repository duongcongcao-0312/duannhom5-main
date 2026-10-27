## Tóm tắt thay đổi

- Mục tiêu của PR là gì?
- Đây là fix/feature/docs/infra hay cải tiến process?
- Có ảnh hưởng tới cấu hình, deployment, data migration hoặc API không?

## Nội dung thay đổi

- [ ] Mô tả rõ chức năng hoặc bug được xử lý.
- [ ] Liên kết issue/requirements tương ứng.
- [ ] Chỉ chứa thay đổi cần thiết cho mục tiêu của PR.
- [ ] Đã kiểm tra ràng buộc về data, bảo mật và môi trường.

## Kiểm thử

- [ ] Đã chạy lệnh kiểm tra phù hợp (`npm test`, `npm run build:pages`, ...).
- [ ] Nếu có thay đổi API/contract, đã cập nhật tài liệu liên quan.
- [ ] Nếu có dữ liệu nhạy cảm, đã loại bỏ khỏi commit và file config.

## Checklist review

- [ ] PR bắt nguồn từ branch đúng quy trình.
- [ ] Mô tả PR đầy đủ, rõ ràng và có thể review được.
- [ ] Code được tách theo trách nhiệm rõ ràng; không có thay đổi lạ.
- [ ] Các comment/feedback đã được xử lý hoặc trả lời rõ ràng.
- [ ] Không còn cảnh báo CI hoặc kiểm thử bị bỏ qua.
- [ ] Merge theo quy tắc của repository: branch `main` và trạng thái CI xanh.

## Ghi chú

- Liệt kê rủi ro, điểm cần reviewer chú ý hoặc câu hỏi mở.
- Nếu cần, ghi rõ khuyến nghị cho lần deploy sau hoặc migration dữ liệu.
