# Changelog

Tất cả thay đổi đáng chú ý của BookNest được ghi lại trong tệp này.

## [0.1.0] - 2026-10-19

Bản phát hành công khai đầu tiên của BookNest.

### Tính năng

- Danh mục 80 đầu sách thuộc 10 thể loại, tìm kiếm, lọc và sắp xếp.
- Trang chi tiết sách, sách liên quan và danh sách yêu thích.
- Giỏ hàng có điều chỉnh số lượng, kiểm tra tồn kho và mã ưu đãi.
- Đặt hàng bằng chuyển khoản QR hoặc thanh toán khi nhận hàng (COD), kèm mã
  tra cứu đơn hàng.
- Đăng ký, đăng nhập, đăng xuất và ưu đãi theo loại tài khoản.
- Đăng ký dịch vụ thuê, thu mua và trao đổi sách.
- Cổng quản trị cho thống kê, đơn hàng, sách, tồn kho, dịch vụ và thành viên.
- Giao diện responsive, hỗ trợ SEO, trang chính sách và triển khai GitHub Pages.

### Sửa lỗi

- Hoàn tất phần hợp nhất xác thực Firebase và lưu thông tin khách hàng.
- Khôi phục header Bearer cho các request đồng bộ hồ sơ và đăng xuất.
- Bổ sung bước build trang tĩnh vào quy trình kiểm tra CI.

### Tương thích và nâng cấp

- Không có breaking change từ phiên bản trước.
- Cần Node.js 20 trở lên. Dữ liệu JSON/JSONL hiện có được giữ nguyên; sao lưu
  thư mục `data/` trước khi triển khai.

### Kiểm thử

- `npm test`
- `npm run build:pages`
- `npm audit --omit=dev`

