# Kiểm tra quyền sử dụng hình ảnh bìa & nội dung sách (`BN-200` / Issue #177)

> **Lưu ý:** Tài liệu này ghi nhận kết quả kiểm kê tài nguyên hiện có trong mã nguồn BookNest và quy trình quản trị quyền sử dụng nội bộ; đơn vị vận hành cần xác nhận trực tiếp tình trạng cấp phép với nhà xuất bản, chủ thể quyền hoặc chuyên gia sở hữu trí tuệ trước khi thương mại hóa.

## 1. Danh mục hình ảnh, nội dung, nguồn gốc & chủ thể quyền

Kết quả kiểm kê trực tiếp từ `books-data.js` (80 đầu sách) và thư mục `assets/`:

| Nhóm tài nguyên | Số lượng / Vị trí | Nguồn gốc | Chủ thể quyền | Căn cứ sử dụng & trạng thái |
| --- | --- | --- | --- | --- |
| **Bìa chữ CSS tự thiết kế** | 69/80 đầu sách (`cover-1`..`cover-5` + `label`) | Tự thiết kế trong `main.css` & `books-data.js` | BookNest | Không sử dụng hình ảnh/tác phẩm bên thứ ba (`cleared_internal`). |
| **Ảnh bìa tham chiếu bên ngoài** | 11/80 đầu sách (`image` trỏ `covers.openlibrary.org`) | Open Library Covers API (Internet Archive) | Nhà xuất bản / Chủ sở hữu bản quyền bìa sách gốc | Chỉ dùng minh họa kỹ thuật/demo; **bắt buộc thay bằng ảnh bìa được NXB/đối tác phân phối cấp phép** trước khi vận hành thương mại (`requires_prelaunch_replacement_or_license`). |
| **Ảnh bìa tải lên qua Admin** | `POST /api/v1/admin/uploads/book-cover` (JPG/PNG/WebP) | Do Quản trị viên tải lên | Nhà xuất bản / Đối tác phân phối | Chỉ cho phép tải lên sau khi có hợp đồng phân phối hoặc văn bản cho phép dùng hình ảnh truyền thông (`license_record_required_per_upload`). |
| **Thông tin thư mục & mô tả sách** | `books-data.js` (`title`, `author`, `price`, `category`, `tag`) & trường `description` | Thông tin nhận diện ấn phẩm / tóm tắt biên soạn nội bộ | Tác giả / NXB / BookNest (phần biên soạn) | Không đăng toàn văn, không đăng chương sách hay trích dẫn dài chưa xin phép (`editorial_review_required`). |
| **Tài nguyên giao diện & thương hiệu** | `assets/favicon.svg`, `main.css`, `admin.css`, `assets/*.js` | Tự phát triển trong dự án | BookNest | Sở hữu nội bộ (`cleared_internal`). |

## 2. Xác minh quyền cấp phép, giới hạn hiển thị & yêu cầu ghi nguồn

- **Giới hạn hiển thị:** Ảnh bìa chỉ phục vụ mục đích nhận diện sản phẩm trên thẻ sách và trang chi tiết (`book.html`), không cung cấp tính năng tải về ảnh gốc hoặc tái phân phối độc lập.
- **Yêu cầu ghi nguồn:** Hiển thị đầy đủ tên sách, tên tác giả và nhà xuất bản (khi có) trên giao diện và API công khai; khi dùng ảnh do NXB cung cấp phải giữ nguyên bố cục bìa, không cắt ghép làm sai lệch thương hiệu.
- **Kiểm soát kỹ thuật:** Quyền tải ảnh bìa (`POST /api/v1/admin/uploads/book-cover`) và sửa danh mục sách (`POST`/`PATCH`/`DELETE /api/v1/admin/books*`) bị giới hạn chặt cho vai trò `admin` (`write:books`), có kiểm tra định dạng tệp, giới hạn dung lượng và ghi audit log.

## 3. Quy trình tiếp nhận yêu cầu gỡ bỏ (Takedown) & lưu hồ sơ cấp phép

1. **Tiếp nhận (`support`):** Tiếp nhận thông báo khiếu nại bản quyền qua kênh CSKH công khai trên `content-rights.html` (yêu cầu: tên người/đơn vị khiếu nại, email liên hệ, tên sách/URL, bằng chứng quyền sở hữu/ủy quyền, yêu cầu xử lý). Xác nhận tiếp nhận trong **1 ngày làm việc** và ghi nhận trên CRM.
2. **Tạm ẩn phòng ngừa (`admin`):** Nếu yêu cầu có căn cứ ban đầu hợp lệ, Quản trị viên tạm ẩn ảnh bìa hoặc chuyển trạng thái sách sang `inactive` trong vòng **24 giờ** và ghi nhận audit log.
3. **Xác minh & xử lý dứt điểm (`admin` + Pháp lý):** Đối chiếu hồ sơ cấp phép với NXB/đối tác; hoàn tất gỡ bỏ vĩnh viễn, chỉnh sửa ghi nguồn hoặc thay ảnh bìa hợp lệ trong **5 ngày làm việc** và phản hồi văn bản cho bên khiếu nại.
4. **Lưu trữ hồ sơ cấp phép & gỡ bỏ:** Lưu trữ hợp đồng/email cấp phép sử dụng hình ảnh của NXB và hồ sơ xử lý khiếu nại bản quyền tối thiểu **5 năm** sau khi nội dung ngừng hiển thị.

## 4. Điểm công khai & kiểm chứng tự động

- Trang công khai: `content-rights.html` (phiên bản `2026-01`), liên kết từ footer `index.html`.
- API công khai: `GET /api/policies/content-rights` và `GET /api/v1/policies/content-rights` (`backend/content-rights-policy.js`).
- Kiểm thử tự động: `tests/content-rights-policy.test.js` kiểm tra định kỳ `auditCatalogRights(books)` để phát hiện kịp thời các nguồn ảnh bên ngoài mới phát sinh trong `books-data.js`.
