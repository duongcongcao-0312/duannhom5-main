# Đóng góp và quy trình PR/review

Tài liệu này mô tả quy trình làm việc thông dụng cho repository BookNest nhằm đảm bảo chất lượng code, tính minh bạch và khả năng review hiệu quả.

## 1. Tạo branch

- Tạo branch dựa trên `main` cho mỗi task/issue.
- Sử dụng tên branch mô tả ngắn gọn, ví dụ:
  - `feature/customer-crm-migration`
  - `fix/login-validation`
  - `docs/pr-review-process`
- Không làm việc trực tiếp trên `main`.

## 2. Mô tả và chuẩn bị PR

Trước khi tạo pull request, đảm bảo:

- Mã nguồn đã được kiểm tra bằng lệnh phù hợp (`npm test`, `npm run build:pages`, `npm run check` nếu có).
- Thay đổi được giới hạn trong phạm vi của issue hoặc task.
- Nếu có thay đổi cấu hình/deploy, đã cập nhật tài liệu liên quan.
- Không commit secret, `.env`, dữ liệu thật hoặc thông tin nhạy cảm.

Mỗi PR nên có:

- Tiêu đề rõ ràng, phản ánh mục tiêu thay đổi.
- Mô tả ngắn gọn về vấn đề cần giải quyết.
- Liên kết tới issue tương ứng hoặc ghi chú logic của task.
- Danh sách kiểm tra test và impact.

## 3. Tiêu chí review code

Reviewer nên kiểm tra các tiêu chí chính sau:

- Logic đúng với yêu cầu và không làm sai lệch luồng hiện có.
- Mã dễ đọc, có cấu trúc rõ ràng và không chứa code dư thừa.
- Không có bug tiềm ẩn, thiếu validate, xử lý lỗi hoặc rủi ro bảo mật.
- Có cập nhật tài liệu nếu thay đổi behavior/API hoặc deployment.
- Test phù hợp đã được thêm/đổi cho trường hợp cần thiết.

## 4. Đánh giá mô tả PR

PR được xem là đầy đủ khi chứa đủ thông tin để reviewer hiểu được:

- Vấn đề đang giải quyết là gì.
- Thay đổi cụ thể đã làm.
- Có ảnh hưởng gì tới frontend/backend/data/deploy.
- Có cần migration, config mới hoặc điều kiện đặc biệt không.
- Có test nào đã chạy và kết quả ra sao.

Nếu mô tả PR thiếu thông tin, người tạo PR phải bổ sung trước khi yêu cầu review.

## 5. Xử lý comment và feedback

- Tất cả comment từ reviewer cần được phản hồi rõ ràng.
- Nếu đồng ý thay đổi, thực hiện và cập nhật commit hoặc amend theo đúng scope.
- Nếu không đồng ý, giải thích rõ lý do bằng lập luận kỹ thuật hoặc đề xuất phương án thay thế.
- Không bỏ qua comment mà không có phản hồi.

## 6. Merge theo quy tắc repository

- PR chỉ được merge khi branch đã được review và CI đạt trạng thái thành công.
- Ưu tiên merge theo quy trình đã được project quy định ở thời điểm đó, thường là merge vào `main` sau khi review và kiểm thử đạt tiêu chuẩn.
- Không merge nếu có thay đổi chưa xử lý hoặc CI đang fail.
- Trong trường hợp có conflict, giải quyết trước khi tiến hành merge.

## 7. Checklist cuối cùng trước khi merge

- [ ] Tạo PR từ branch đúng quy trình.
- [ ] Mô tả PR đầy đủ và dễ đọc.
- [ ] Review code đã hoàn tất.
- [ ] Các comment đã được xử lý.
- [ ] CI/kiểm thử xanh.
- [ ] Merge theo đúng rule của repository.

## 8. Tài liệu tham khảo

- [README.md](README.md)
- [.github/pull_request_template.md](.github/pull_request_template.md)
- [docs/deployment.md](docs/deployment.md)
