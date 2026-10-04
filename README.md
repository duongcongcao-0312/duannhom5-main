# Dự Án Sách Sinh Viên CMCU
# BookNest

BookNest là một website bán sách trực tuyến kiểu storefront, được xây dựng để mang đến trải nghiệm mua sắm, tìm kiếm và khám phá sách một cách dễ dàng, hiện đại và thân thiện với người dùng.

Dự án này tập trung vào trải nghiệm người dùng ở một trang web tĩnh (static website) với các tính năng như hiển thị danh sách sách, lọc theo thể loại, giỏ hàng, thanh toán, đăng nhập/đăng ký tài khoản, cũng như dịch vụ thuê/thu mua/trao đổi sách.

## Mô tả dự án

BookNest là một cửa hàng sách trực tuyến giúp người dùng:

- Khám phá các đầu sách theo từng chủ đề
- Tìm kiếm sách theo tên hoặc tác giả
- Lọc sách theo thể loại và mùa đọc
- Thêm sách vào giỏ hàng và đặt hàng
- Đăng nhập / đăng ký tài khoản hội viên
- Xem thông tin ưu đãi thành viên
- Sử dụng trợ lý AI gợi ý sách nhanh chóng
- Đăng ký các dịch vụ thuê sách, thu mua sách và trao đổi sách

## Tính năng chính

### 1. Trang chủ trực quan
- Hero section nổi bật với slogan và hình ảnh sách
- Phần giới thiệu các mùa đọc
- Hiển thị bộ sưu tập sách nổi bật
- Giao diện tối ưu cho thiết bị di động và máy tính

### 2. Tìm kiếm và lọc sách
- Tìm kiếm theo tên sách hoặc tác giả
- Lọc theo thể loại
- Lọc theo cảm xúc / mùa đọc

### 3. Giỏ hàng và thanh toán
- Thêm sách vào giỏ hàng
- Cập nhật số lượng sản phẩm
- Tính tổng tiền
- Hiển thị form thanh toán và giao hàng

### 4. Tài khoản hội viên
- Đăng nhập
- Đăng ký tài khoản
- Hiển thị thẻ hội viên
- Cấp ưu đãi dành cho thành viên

### 5. Trợ lý AI BookNest
- Hỗ trợ gợi ý sách
- Trả lời nhanh các câu hỏi liên quan đến sách, ưu đãi và dịch vụ
- Tạo trải nghiệm tương tác thân thiện hơn

### 6. Dịch vụ bổ sung
- Cho thuê sách
- Thu mua sách
- Trao đổi sách

## Công nghệ sử dụng

- HTML5
- CSS3
- JavaScript
- Node.js (cho chạy kiểm thử đơn giản)
- Static web app pattern

## Cấu trúc thư mục chính

```bash
.
├── index.html              # Trang chủ chính
├── main.css                # File stylesheet
├── main.js                 # Logic giao diện và xử lý tương tác
├── book.html               # Trang chi tiết sách
├── book-detail.js          # Logic cho trang chi tiết sách
├── privacy.html            # Chính sách bảo mật
├── terms.html              # Điều khoản sử dụng
├── 404.html               # Trang lỗi 404
├── 500.html               # Trang lỗi 500
├── manifest.json           # Metadata ứng dụng web
├── assets/                 # Hình ảnh, icon, tài nguyên
├── tests/                  # Các bài kiểm thử
├── package.json            # Dữ liệu dự án và script
├── README.md               # Tài liệu dự án
└── .env.example            # Mẫu biến môi trường
```

## Cài đặt và chạy dự án

### Yêu cầu
- Trình duyệt hiện đại
- Node.js (nếu muốn chạy test)
- Một máy chủ tĩnh hoặc trình preview

### Chạy local
Bạn có thể mở trực tiếp file `index.html` trong trình duyệt, hoặc chạy một máy chủ tĩnh:

```bash
python -m http.server 8000
```

Sau đó truy cập:

```bash
http://localhost:8000
```

### Chạy test
```bash
npm test
```

## Mục tiêu của dự án

Dự án BookNest nhằm tạo ra một giao diện website bán sách trực tuyến thân thiện, dễ sử dụng và giàu tính tương tác, phù hợp cho mục tiêu học tập, thực hành frontend và xây dựng sản phẩm thương mại trực tuyến cơ bản.

## Kết luận

BookNest không chỉ là một trang web bán sách, mà còn là một trải nghiệm đọc sách hiện đại, kết hợp giữa thương mại, nội dung và tương tác người dùng. Dự án này phù hợp để thể hiện khả năng xây dựng giao diện web, thiết kế UX/UI và triển khai ứng dụng tĩnh chuyên nghiệp.

---

Nếu bạn muốn, tôi có thể viết thêm cho bạn:
- Một phiên bản README ngắn gọn hơn cho GitHub
- Một phiên bản README chuyên nghiệp hơn theo chuẩn project
- Một README bằng tiếng Anh
- Một README kèm hình ảnh và bảng mục lục
