# Tài liệu Kiến trúc Phần mềm - BookNest

## 1. Tổng quan Hệ thống

**BookNest** là một hệ thống quản lý nhà sách trực tuyến (Online Bookstore Management System) được phát triển bằng JavaScript, HTML, CSS và Node.js. Hệ thống cung cấp các tính năng:
- Duyệt và mua sách
- Quản lý giỏ hàng
- Đăng nhập người dùng
- Quản trị viên
- Dịch vụ bổ trợ (thuê sách, trao đổi, thu mua)

---

## 2. Kiến trúc Tổng thể

### 2.1 Mô hình Client-Server

```
┌─────────────────────────────────────────────────────────┐
│                    WEB BROWSER (Client)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   index.html │  │  book.html   │  │ admin.html   │  │
│  │  (Trang chủ) │  │(Chi tiết sách)│ │ (Quản trị)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌─────────────────────────────────────────────────────┐
│  │   JavaScript Layer (Client-side Logic)              │
│  │  ├─ main.js (Xử lý trang chủ)                       │
│  │  ├─ book-detail.js (Chi tiết sách)                  │
│  │  ├─ admin.js (Quản trị)                             │
│  │  ├─ books-data.js (Dữ liệu sách)                    │
│  │  └─ main.css, admin.css (Styling)                   │
│  └─────────────────────────────────────────────────────┘
│  ┌─────────────────────────────────────────────────────┐
│  │   Local Storage (Client-side Persistence)           │
│  │  ├─ booknest-cart (Giỏ hàng)                        │
│  │  ├─ booknest-favorites (Yêu thích)                  │
│  │  ├─ booknest-users (Người dùng)                     │
│  │  ├─ booknest-current-user (User đang đăng nhập)     │
│  │  └─ booknest-coupon (Mã giảm giá)                   │
│  └─────────────────────────────────────────────────────┘
└─────────────────────┬──────────────────────────────────┘
                      │ HTTP/REST API
                      │
┌─────────────────────▼──────────────────────────────────┐
│              Node.js Server (Backend)                   │
│              (server.js)                                │
│  ┌─────────────────────────────────────────────────────┐
│  │   HTTP Server (port 3000)                           │
│  │  ├─ Static File Serving                             │
│  │  │  ├─ HTML files (index.html, admin.html, etc.)    │
│  │  │  ├─ CSS files (main.css, admin.css)              │
│  │  │  ├─ JavaScript files                             │
│  │  │  └─ Assets (SVG, icons)                          │
│  │  └─ REST API Endpoints                              │
│  │     ├─ /api/books (Dữ liệu sách)                    │
│  │     ├─ /api/orders (Quản lý đơn hàng)               │
│  │     ├─ /api/auth (Xác thực)                         │
│  │     ├─ /api/cart (Giỏ hàng)                         │
│  │     └─ /api/services (Dịch vụ)                      │
│  │                                                      │
│  ├─ Business Logic Layer                               │
│  │  ├─ Database Management                             │
│  │  │  └─ Database class (db.js)                       │
│  │  │     ├─ Quản lý đơn hàng                          │
│  │  │     ├─ Quản lý sách                              │
│  │  │     └─ Quản lý người dùng                        │
│  │  │                                                   │
│  │  └─ Authentication & Authorization                  │
│  │     ├─ SessionStore class (auth.js)                 │
│  │     ├─ Password verification                        │
│  │     └─ Token management                             │
│  │                                                      │
│  └─ Data Persistence Layer                             │
│     ├─ /data/orders.jsonl (Đơn hàng)                   │
│     ├─ /data/users.json (Người dùng)                   │
│     ├─ /data/services.json (Dịch vụ)                   │
│     └─ books-data.js (Catalog sách)                    │
└─────────────────────┬──────────────────────────────────┘
                      │
    ┌─────────────────┴─────────────────┐
    │                                   │
    ▼                                   ▼
┌──────────────────┐         ┌──────────────────┐
│  File System     │         │  External APIs   │
│  (Local storage) │         │  (OpenLibrary)   │
└──────────────────┘         └──────────────────┘
```

---

## 3. Các thành phần chính

### 3.1 Frontend (Client Layer)

#### 3.1.1 **Trang chủ - index.html & main.js**
- **Chức năng**: Hiển thị danh sách sách, bộ lọc, tìm kiếm
- **Các module con**:
  - **Catalog Display**: Hiển thị grid sách
  - **Search & Filter**:
    - Tìm kiếm theo tên sách
    - Lọc theo thể loại (10 danh mục)
    - Sắp xếp: theo tên, giá, mới nhất
  - **Cart Management**: Quản lý giỏ hàng
  - **User Authentication**: Đăng nhập/đăng ký
  - **Favorites**: Danh sách yêu thích

**Dữ liệu sử dụng**:
```javascript
categories = [
  'van-hoc' (Văn học),
  'ky-nang' (Kỹ năng sống),
  'kinh-te' (Kinh tế),
  'khoa-hoc' (Khoa học),
  'lich-su' (Lịch sử),
  'thieu-nhi' (Thiếu nhi),
  'trinh-tham' (Trinh thám),
  'tam-ly' (Tâm lý),
  'cong-nghe' (Công nghệ),
  'ngoai-ngu' (Ngoại ngữ)
]
```

#### 3.1.2 **Chi tiết sách - book.html & book-detail.js**
- **Chức năng**: Hiển thị thông tin chi tiết của một cuốn sách
- **Các yếu tố**:
  - Hình ảnh bìa (từ OpenLibrary API)
  - Tên sách, tác giả, giá bán
  - Mô tả chi tiết theo thể loại
  - Nút thêm vào giỏ hàng
  - Nút yêu thích

#### 3.1.3 **Trang Quản trị - admin.html & admin.js**
- **Chức năng**: Dashboard quản trị viên
- **Các tính năng**:
  - **Bảng điều khiển**: Thống kê tổng doanh thu, đơn hàng, người dùng
  - **Quản lý đơn hàng**: Xem, cập nhật trạng thái đơn hàng
  - **Quản lý sách**: Thêm, sửa, xóa sách
  - **Quản lý dịch vụ**: Xem yêu cầu dịch vụ (thuê, trao đổi, thu mua)
  - **Quản lý người dùng**: Xem danh sách người dùng

#### 3.1.4 **Dữ liệu Sách - books-data.js**
- **Chức năng**: Lưu trữ catalog sách
- **Cấu trúc**:
```javascript
{
  id: string,
  title: string,
  author: string,
  price: number,
  category: string,
  image: string (URL),
  stock: number
}
```

### 3.2 Backend (Server Layer)

#### 3.2.1 **HTTP Server - server.js**
- **Framework**: Node.js native HTTP module (no frameworks)
- **Port**: 3000
- **Chức năng**:
  - Phục vụ file tĩnh (HTML, CSS, JS)
  - Xử lý REST API requests
  - Quản lý CORS
  - Error handling

**MIME Types hỗ trợ**:
```
.css, .html, .ico, .js, .jpg, .jpeg, .json, 
.png, .svg, .txt, .webp, .xml
```

#### 3.2.2 **Database Management - backend/db.js**
- **Lớp trừu tượng**: Database class
- **Chức năng**:
  - Quản lý dữ liệu sách (books)
  - Quản lý đơn hàng (orders)
  - Quản lý người dùng (users)
  - Quản lý dịch vụ (services)

**Các phương thức chính**:
```javascript
// Books
getBooks()
getBook(id)
addBook(book)
updateBook(id, book)
deleteBook(id)

// Orders
getOrders()
getOrder(id)
createOrder(order)
updateOrderStatus(id, status)
cancelOrder(id)

// Users
registerUser(user)
authenticateUser(email, password)
getUser(id)

// Services
getServiceRequests()
submitServiceRequest(request)
updateServiceRequest(id, status)
```

**Lưu trữ**:
- `/data/orders.jsonl` - Đơn hàng (JSONL format)
- `/data/users.json` - Người dùng
- `/data/services.json` - Dịch vụ
- `books-data.js` - Catalog sách

#### 3.2.3 **Authentication & Sessions - backend/auth.js**
- **Lớp**: SessionStore, verifyPassword
- **Chức năng**:
  - Quản lý phiên đăng nhập
  - Xác minh mật khẩu
  - Token generation & validation
  - Role-based access control (Admin vs User)

**Token Management**:
```
localStorage key: 'booknest-admin-token'
Header: 'Authorization: Bearer {token}'
```

**Roles**:
- `admin` - Quản trị viên (admin@booknest.vn)
- `user` - Người dùng thường

### 3.3 Data Layer

#### 3.3.1 **Local Storage (Client)**
```javascript
'booknest-cart' → JSON array of book titles
'booknest-favorites' → JSON array of book titles
'booknest-users' → JSON object of registered users
'booknest-current-user' → Current logged-in user object
'booknest-coupon' → Applied coupon code
'booknest-auth-token' → Authentication token
```

#### 3.3.2 **Server-side File Storage**
```
data/
├── orders.jsonl (line-delimited JSON)
├── users.json
├── services.json
└── books-data.js (exported JavaScript)
```

#### 3.3.3 **Voucher/Coupon System**
```javascript
coupons = {
  'BOOKNEST10': { rate: 0.1, label: 'Ưu đãi BookNest' },
  'WELCOME5': { rate: 0.05, label: 'Ưu đãi chào mừng' }
}
```

---

## 4. Quy trình Chính

### 4.1 Quy trình Mua sách
```
1. User duyệt sách trên trang chủ (index.html)
   ↓
2. User nhấp "Thêm vào giỏ" hoặc xem chi tiết
   ↓
3. Dữ liệu được lưu vào Local Storage ('booknest-cart')
   ↓
4. User xem giỏ hàng và đặt hàng
   ↓
5. API POST /api/orders được gọi → Backend lưu vào orders.jsonl
   ↓
6. User nhận mã đơn hàng để tra cứu
```

### 4.2 Quy trình Đăng nhập
```
1. User nhấp nút "Đăng nhập" trên header
   ↓
2. Modal login form xuất hiện
   ↓
3. User nhập email & mật khẩu
   ↓
4. POST /api/auth/login → Backend verify
   ↓
5. Nếu thành công → Token lưu vào localStorage
   ↓
6. User có thể xem lịch sử đơn hàng & thông tin tài khoản
```

### 4.3 Quy trình Quản trị
```
1. Admin đăng nhập (admin@booknest.vn)
   ↓
2. Truy cập admin.html
   ↓
3. Admin xem dashboard với thống kê
   ↓
4. Admin quản lý (view, edit, delete):
   - Đơn hàng
   - Sách trong catalog
   - Yêu cầu dịch vụ
   - Người dùng
   ↓
5. Các thay đổi được lưu vào Backend
```

---

## 5. REST API Endpoints

### 5.1 Books API
```
GET /api/books                 → Lấy tất cả sách
GET /api/books/{id}            → Lấy chi tiết sách
POST /api/books                → Thêm sách mới (Admin)
PUT /api/books/{id}            → Cập nhật sách (Admin)
DELETE /api/books/{id}         → Xóa sách (Admin)
```

### 5.2 Orders API
```
GET /api/orders                → Lấy tất cả đơn (Admin)
GET /api/orders/{id}           → Lấy chi tiết đơn
POST /api/orders               → Tạo đơn hàng mới
PUT /api/orders/{id}/status    → Cập nhật trạng thái (Admin)
DELETE /api/orders/{id}        → Huỷ đơn hàng
```

### 5.3 Auth API
```
POST /api/auth/register        → Đăng ký tài khoản
POST /api/auth/login           → Đăng nhập
GET /api/auth/me               → Lấy info user hiện tại
POST /api/auth/logout          → Đăng xuất
```

### 5.4 Cart API (Client-side via LocalStorage)
```
GET cart items                 → JSON.parse(localStorage.getItem('booknest-cart'))
ADD to cart                    → localStorage.setItem('booknest-cart', JSON.stringify(...))
REMOVE from cart               → Update localStorage
CLEAR cart                     → localStorage.removeItem('booknest-cart')
```

### 5.5 Services API
```
GET /api/services/requests     → Lấy yêu cầu dịch vụ
POST /api/services/requests    → Tạo yêu cầu dịch vụ mới (rent/exchange/buyback)
PUT /api/services/requests/{id}→ Cập nhật trạng thái (Admin)
```

---

## 6. Luồng Dữ liệu

### 6.1 Tìm kiếm & Lọc sách
```
User Input (search, filter)
    ↓
main.js: Event Listeners
    ↓
Filter books array in memory
    ↓
Re-render bookGrid DOM
    ↓
Display filtered results
```

### 6.2 Giỏ hàng
```
Click "Add to Cart"
    ↓
main.js: addToCart(book)
    ↓
Update state.cart array
    ↓
localStorage.setItem('booknest-cart', JSON.stringify(cart))
    ↓
Update cart count badge
    ↓
Show notification
```

### 6.3 Đặt hàng
```
User clicks "Checkout"
    ↓
Collect cart items + user info
    ↓
POST /api/orders with payload
    ↓
server.js: receives request
    ↓
Database: append to orders.jsonl
    ↓
Return Order ID to client
    ↓
localStorage.clear('booknest-cart')
    ↓
Display success message
```

---

## 7. Thành phần Hiển thị (UI Components)

### 7.1 CSS Architecture (main.css & admin.css)

**Design System**:
```css
:root {
  --primary: #1d5545 (Xanh lá đậm)
  --accent: #c99436 (Vàng kim)
  --bg-main: #f6f8f7
  --bg-card: #ffffff
  --text-main: #1f2937
  --text-muted: #6b7280
  --border: #e5e7eb
  --success: #10b981
  --warning: #f59e0b
  --danger: #ef4444
}
```

**Component Pattern**:
- **Header** - Site header với navigation
- **Cards** - Book cards, stat cards
- **Forms** - Login, search, filters
- **Modal** - Dialogs, cart, checkout
- **Grid** - Book grid layout
- **Tables** - Admin tables

### 7.2 Responsive Design
- Mobile-first approach
- Breakpoints: sm, md, lg
- Flexbox & Grid layouts

---

## 8. Bảo mật

### 8.1 Authentication
- Password hashing (via `verifyPassword()`)
- JWT tokens (stored in localStorage)
- Role-based access control

### 8.2 XSS Prevention
```javascript
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

### 8.3 CORS
- `Access-Control-Allow-Origin: *` (khi không có auth)
- Authenticated requests: bearer token

### 8.4 Input Validation
- Sanitize user input trước khi lưu DB
- Validate email format
- Validate product IDs & quantities

---

## 9. Hiệu suất & Tối ưu

### 9.1 Client-side
- Lazy loading hình ảnh (OpenLibrary API)
- Caching dữ liệu sách (globalThis.BOOKNEST_BOOKS)
- Local storage cho cart/favorites (không cần API call)
- Event delegation cho dynamic elements

### 9.2 Server-side
- Static file serving (CDN-ready)
- JSONL format cho orders (append-only)
- In-memory caching cho catalog
- Efficient database queries

### 9.3 Network
- Minimize JSON payload size
- Gzip compression (server config)
- Reuse connections

---

## 10. Error Handling

### 10.1 Client-side
```javascript
try {
  const savedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
  if (!Array.isArray(savedCart)) return [];
  return savedCart.map(...)
} catch (error) {
  return [];
}
```

### 10.2 Server-side
```javascript
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sendHtmlError(response, status, pageName) {
  // Error page handling
}
```

### 10.3 HTTP Status Codes
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

---

## 11. Scalability & Maintenance

### 11.1 Cấu trúc thư mục hiện tại
```
duannhom5-main/
├── index.html (Trang chủ)
├── admin.html (Admin panel)
├── book.html (Chi tiết sách)
├── main.js (Trang chủ logic)
├── admin.js (Admin logic)
├── book-detail.js (Chi tiết sách logic)
├── books-data.js (Catalog)
├── main.css (Styling)
├── admin.css (Admin styling)
├── server.js (HTTP server)
├── backend/
│   ├── db.js (Database layer)
│   └── auth.js (Auth layer)
├── data/
│   ├── orders.jsonl
│   ├── users.json
│   └── services.json
├── assets/
│   ├── favicon.svg
│   └── ...
├── tests/
│   ├── site.test.js
│   └── backend.test.js
├── package.json
└── ...
```

### 11.2 Cải thiện trong tương lai
1. **Migrate to Framework**: Express.js hoặc Fastify
2. **Database**: PostgreSQL/MongoDB thay file-based
3. **Frontend Framework**: React/Vue cho component reusability
4. **Testing**: Jest, Cypress cho unit & e2e tests
5. **CI/CD**: GitHub Actions workflows
6. **Containerization**: Docker for deployment

---

## 12. Dependency & Integration

### 12.1 External APIs
- **OpenLibrary API**: Lấy hình ảnh bìa sách
  ```
  https://covers.openlibrary.org/b/title/{title}-L.jpg
  ```

### 12.2 Built-in Modules (Node.js)
- `node:fs/promises` - File system
- `node:http` - HTTP server
- `node:path` - Path utilities
- `node:crypto` - UUID generation

### 12.3 Browser APIs
- **localStorage** - Persistent client storage
- **fetch API** - HTTP requests
- **DOM API** - DOM manipulation

---

## 13. Deployment

### 13.1 Development
```bash
npm install
npm start  # Chạy server.js
# Truy cập http://localhost:3000
```

### 13.2 Testing
```bash
npm test
npm run test:site
npm run test:backend:auth
npm run test:backend:customer
npm run test:postgres-ssl
```
Tests được chia theo site, runtime/backend config, workflow tích hợp, auth,
admin, customer, validation và PostgreSQL SSL. Mỗi file backend là một tiến
trình test riêng để tránh chia sẻ trạng thái giữa các nhóm; có thể chạy riêng
từng nhóm bằng các lệnh `test:backend:*` khi cần chẩn đoán lỗi.

`backend-workflow.test.js` giữ các thao tác phụ thuộc nhau trong cùng một
integration test vì chúng xác minh một luồng xuyên suốt; các test khác tạo và
dọn dữ liệu riêng để chạy độc lập.

### 13.3 Production
- Deploy lên: GitHub Pages, Vercel, Heroku, hoặc VPS
- Cấu hình environment variables
- Enable HTTPS
- Setup database (migrate từ file-based)

---

## 14. Tóm tắt kiến trúc

| Tầng | Công nghệ | Chức năng | Tệp chính |
|------|-----------|----------|----------|
| **Presentation** | HTML5, CSS3 | UI/UX | index.html, admin.html, book.html |
| **Client Logic** | JavaScript (ES6+) | Event handling, state management | main.js, admin.js, book-detail.js |
| **Client Storage** | localStorage | Persistent data | Cart, favorites, user session |
| **Server** | Node.js (native HTTP) | API, file serving | server.js |
| **Business Logic** | JavaScript | Orders, books, users, auth | db.js, auth.js |
| **Data Storage** | JSON/JSONL files | Persistence | orders.jsonl, users.json, services.json |
| **Styling** | CSS3 | Design system | main.css, admin.css |

---

**Phiên bản**: 1.0.0  
**Cập nhật lần cuối**: 2026-10-12  
**Trạng thái**: Production-ready (với cải thiện)
