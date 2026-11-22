# API Endpoint Security Audit (`BN-033` / Issue #195)

Tài liệu kiểm kê toàn bộ API endpoint của BookNest, làm rõ phương thức, dữ liệu truy cập, yêu cầu xác thực (Authentication), phân quyền theo vai trò (RBAC), kiểm soát quyền sở hữu (Ownership/IDOR) và các đường dẫn thay thế (`/api/*` và `/api/v1/*`).

## Quy tắc chung & đường dẫn thay thế

- **API Versioning**: Mọi endpoint `/api/v1/...` là đường dẫn chuẩn; `/api/...` là alias tương thích ngược (trả header `Deprecation`/`Link`) đi qua cùng một chuỗi middleware xác thực và phân quyền. Phiên bản không hỗ trợ (ví dụ `/api/v2/...`) bị từ chối với `404`.
- **Fail-closed**: Mọi route `/api/admin/*` không khai báo trong `backend/router.js` hoặc sai phương thức đều bị chặn (`401` nếu chưa đăng nhập, `403` nếu đã đăng nhập). Đường dẫn chứa path traversal (`..`, `.`, ký tự điều khiển) bị chặn với `400`.
- **Anti-tampering**: `userId` và `role` luôn lấy từ `sessionStore` phía server, không tin tưởng header client (`X-Role`, `X-Admin`) hay trường payload (`role`, `userId`, `subjectId`).

---

## 1. Endpoint công khai (Public)

| Endpoint | Method | Dữ liệu truy cập & hành động | Auth | Role / Quyền | Kiểm soát dữ liệu / Ownership |
| --- | --- | --- | --- | --- | --- |
| `/health`, `/ready` | `GET`, `HEAD` | Trạng thái sống/sẵn sàng của dịch vụ & DB | Public | — | Không lộ cấu hình bí mật hay stack trace |
| `/api/v1/version` | `GET` | Chính sách phiên bản API | Public | — | Read-only |
| `/api/v1/books`, `/api/v1/categories`, `/api/v1/authors`, `/api/v1/publishers` | `GET` | Danh mục sách, thể loại, tác giả, NXB đang hoạt động | Public | — | Chỉ trả bản ghi active; query validation & phân trang |
| `/api/v1/coupons/:code` | `GET` | Kiểm tra hợp lệ một mã giảm giá cụ thể | Public | — | Không liệt kê toàn bộ danh sách coupon |
| `/api/v1/policies/privacy`, `/terms`, `/shipping`, `/return`, `/refund` | `GET` | Nội dung chính sách pháp lý & vận hành | Public | — | Read-only |
| `/api/v1/uploads/book-covers/:file` | `GET` | Tải ảnh bìa sách đã lưu | Public | — | `resolveSafeStoredUploadPath` chặn path traversal; CSP sandbox |
| `/api/v1/payments/config` | `GET` | Thông tin tài khoản ngân hàng nhận chuyển khoản | Public | — | Không lộ `SEPAY_API_KEY` |
| `/api/v1/orders/quote` | `POST` | Tính báo giá giỏ hàng phía server | Optional Bearer | — | Server tự tính giá & ưu đãi sinh viên theo session đã xác minh |
| `/api/v1/services` | `POST` | Tạo yêu cầu thuê/thu mua/trao đổi sách | Optional Bearer | — | `userId` gắn từ session nếu đăng nhập; schema chặn trường thừa |

---

## 2. Xác thực & Hồ sơ tài khoản (Auth & Users)

| Endpoint | Method | Dữ liệu truy cập & hành động | Auth | Role / Quyền | Kiểm soát dữ liệu / Ownership |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/auth/register` | `POST` | Đăng ký tài khoản khách hàng mới | Public | — | Luôn gán `role: "user"`; chặn `role`, `isActive`, `studentVerification` (`400`); rate limit |
| `/api/v1/auth/login` | `POST` | Đăng nhập email/mật khẩu, tạo session token | Public | — | Rate limit theo IP; chặn tài khoản bị khóa (`isActive: false`) |
| `/api/v1/auth/social` | `POST` | Đăng nhập Firebase/Google social | Public (ID Token) | Non-admin | Verify ID token phía server; chặn tuyệt đối tài khoản `admin` |
| `/api/v1/auth/password-reset`, `/password-reset/confirm` | `POST` | Gửi link & xác nhận đặt lại mật khẩu | Public | — | Rate limit IP + email; đổi mật khẩu thu hồi toàn bộ session cũ |
| `/api/v1/auth/logout` | `POST` | Hủy session hiện tại | Bearer Session | Any | Hủy đúng token trong header `Authorization` |
| `/api/v1/auth/me` | `GET` | Đọc hồ sơ tài khoản hiện tại | Bearer Session | Owner | Chặn query param (`?userId=` → `400`); luôn trả `session.userId` |
| `/api/v1/auth/customer-info` | `PATCH` | Tự cập nhật tên, SĐT, địa chỉ mặc định | Bearer Session | Owner | Luôn ghi theo `session.userId`; đổi SĐT cần re-auth (`428`); chặn `role`/`userId`/`id` (`403`) |
| `/api/v1/auth/social/link`, `/social/unlink` | `POST` | Liên kết/tách tài khoản social | Bearer Session | Non-admin Owner | Yêu cầu xác thực lại mật khẩu; chặn `admin` (`403`) |
| `/api/v1/users/:id` | `GET`, `PATCH`, `PUT`, `DELETE` | Đọc/cập nhật/xóa hồ sơ theo ID | Bearer Session | Owner hoặc `read:users`/`write:users` | `requireOwnershipOrPermission` chặn IDOR (`403`); `DELETE` trả `403` (bắt buộc qua DSAR) |

---

## 3. Địa chỉ giao hàng & Đơn hàng (Addresses & Orders)

| Endpoint | Method | Dữ liệu truy cập & hành động | Auth | Role / Quyền | Kiểm soát dữ liệu / Ownership |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/addresses` | `GET`, `POST` | Liệt kê / tạo địa chỉ giao hàng của bản thân | Bearer Session | Owner | Chặn `?userId=` và payload `userId` (`400`); chỉ thao tác trên `session.userId` |
| `/api/v1/addresses/:id` | `GET`, `PUT`, `PATCH`, `DELETE` | Đọc / sửa / xóa một địa chỉ giao hàng | Bearer Session | Owner hoặc `read:users`/`write:users` | `requireOwnershipOrPermission` chặn IDOR (`403`); chặn chuyển `userId` (`400`) |
| `/api/v1/orders` | `GET` | Liệt kê đơn hàng của bản thân | Bearer Session | Owner | Chặn `?userId=` (`400`); lọc cứng `order.userId === requester.userId` |
| `/api/v1/orders` | `POST` | Tạo đơn hàng (khách hoặc đã đăng nhập) | Optional Bearer | — | Chặn `userId`/`status`/`paymentStatus` (`400`); kiểm tra quyền sở hữu `addressId` (`403`); đơn khách cần `accessCode` 64 hex |
| `/api/v1/orders/:id`, `/orders/:id/status` | `GET` | Xem chi tiết công khai / trạng thái đơn | Bearer hoặc Access Code | Owner / Admin / Guest Access Code | Đơn có `userId`: chưa đăng nhập → `401`, khác chủ & không phải Admin → `403`. Đơn khách: sai/thiếu `X-Order-Access-Code` → `404`; không lộ PII |
| `/api/v1/orders/:id` | `PATCH`, `PUT` | Hủy đơn (User) hoặc sửa đơn (Admin) | Bearer Session | Owner / Admin | Khác chủ & không phải Admin → `403`; User chỉ được chuyển `status: "cancelled"`, không được sửa `paymentStatus`/`items` (`403`) |
| `/api/v1/orders/:id` | `DELETE` | Không hỗ trợ xóa trực tiếp | Bearer Session | Owner / Admin | Khác chủ & không phải Admin → `403`; chủ đơn/Admin → `405` |

---

## 4. Dữ liệu cá nhân & Quyền riêng tư (Privacy & DSAR)

| Endpoint | Method | Dữ liệu truy cập & hành động | Auth | Role / Quyền | Kiểm soát dữ liệu / Ownership |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/privacy/consents` | `GET`, `POST` | Đọc / ghi nhận lịch sử đồng ý (consent) | Bearer Session | Owner | Chặn query param & `userId` (`400`); gắn cứng `session.userId` |
| `/api/v1/privacy/consents/:purpose` | `DELETE` | Thu hồi consent theo mục đích | Bearer Session | Owner | Chỉ chấp nhận `policyVersion`; thu hồi riêng của `session.userId` |
| `/api/v1/privacy/data-requests` | `GET`, `POST` | Xem / gửi yêu cầu DSAR (`access`/`update`/`export`/`delete`) | Bearer Session | Owner | Chặn query param & `subjectId` (`400`); gắn cứng `session.userId` |
| `/api/v1/privacy/exports` | `GET`, `POST` | Xem / tạo bản xuất dữ liệu cá nhân JSON | Bearer Session | Owner | Chặn query param (`400`); yêu cầu re-auth (`428`); rate limit & chống tạo trùng (`409`) |
| `/api/v1/privacy/exports/:id/download` | `GET` | Tải gói dữ liệu cá nhân đã xuất | Bearer Session + `X-Export-Token` | Owner | Kiểm tra đồng thời `session.userId === export.userId` (`403`) và token 1 lần + hạn 15 phút (`410`) |

---

## 5. Endpoint nội bộ / Webhook thanh toán (Internal Webhooks)

| Endpoint | Method | Dữ liệu truy cập & hành động | Auth | Role / Quyền | Kiểm soát dữ liệu |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/payments/webhook` | `POST` | Cập nhật trạng thái thanh toán từ cổng thanh toán | `X-BookNest-Signature` (HMAC-SHA256) | Internal system | `timingSafeEqual`, kiểm tra payload & chống replay trùng event ID |
| `/api/v1/payments/sepay-webhook` | `POST` | Đối chiếu giao dịch chuyển khoản SePay | `Authorization: Apikey <SEPAY_API_KEY>` | Internal system | `timingSafeEqual`, khớp tài khoản nhận, mã `BN...` và đúng số tiền đơn |

---

## 6. Endpoint CRM & Quản trị (CRM & Admin)

*Đường dẫn thay thế `/api/customers*` và `/api/admin/customers*` đều đi qua cùng `requireCustomerPermission`.*

| Endpoint | Method | Hành động | Auth | Quyền yêu cầu | Vai trò được phép |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/admin/stats`, `/monitoring` | `GET` | Xem thống kê & giám sát hệ thống | Bearer Session | `read:dashboard` | `admin`, `sales` |
| `/api/v1/admin/orders` | `GET` | Xem danh sách đơn hàng quản trị | Bearer Session | `read:orders` | `admin`, `sales` |
| `/api/v1/admin/orders/:id` | `PATCH`, `PUT` | Cập nhật trạng thái đơn / thanh toán | Bearer Session | `write:orders` | `admin` (đầy đủ), `sales` (chỉ `status`, cấm `paymentStatus`) |
| `/api/v1/admin/services`, `/services/:id` | `GET`, `PATCH`, `PUT` | Xem & cập nhật trạng thái dịch vụ | Bearer Session | `read:services` / `write:services` | `admin`, `sales`, `support` |
| `/api/v1/admin/books*`, `/categories*`, `/authors*`, `/publishers*`, `/uploads/book-cover` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | Quản trị danh mục sách, giá, tồn kho, ảnh bìa | Bearer Session | `read:books` / `write:books` | `admin` |
| `/api/v1/admin/coupons*` | `GET`, `POST`, `PUT`, `PATCH` | Quản trị mã giảm giá | Bearer Session | `read:coupons` / `write:coupons` | `admin` |
| `/api/v1/admin/users`, `/users/:id` | `GET`, `PATCH` | Xem danh sách user & xác minh sinh viên | Bearer Session | `read:users` / `write:users` | `admin` |
| `/api/v1/admin/staff`, `/staff/:id` | `GET`, `POST`, `PATCH` | Quản trị tài khoản `sales`/`support` (cấm tạo `admin`) | Bearer Session | `read:staff` / `write:staff` | `admin` |
| `/api/v1/admin/audit` | `GET` | Đọc nhật ký kiểm toán bất biến (mọi method ghi → `405`) | Bearer Session | `read:audit` | `admin` |
| `/api/v1/admin/privacy/data-requests*` | `GET`, `PATCH` | Quản lý hàng đợi DSAR & ẩn danh tài khoản | Bearer Session | `read:privacy` / `write:privacy` | `admin` |
| `/api/v1/(admin/)?customers` | `GET` / `POST` | Xem / tạo khách hàng CRM | Bearer Session | `view` / `create` | `GET`: `admin`, `sales`, `support`; `POST`: `admin`, `sales` |
| `/api/v1/(admin/)?customers/:id` | `GET` / `PUT`,`PATCH` / `DELETE` | Xem / sửa / xóa mềm khách hàng CRM | Bearer Session | `view` / `update` / `delete` | `GET`: `admin`,`sales`,`support`; `PATCH/PUT`: `admin`,`sales`; `DELETE`: `admin` |
| `/api/v1/(admin/)?customers/:id/interactions*` | `GET` / `POST` / `PUT`,`PATCH` / `DELETE` | Xem / tạo / sửa / xóa tương tác CRM | Bearer Session | `interaction:*` | `GET`,`POST`: `admin`,`sales`,`support`; `PATCH/PUT`: `admin`,`sales`; `DELETE`: `admin` |

---

## 7. Kết quả rà soát & kiểm thử tự động

- Toàn bộ danh mục endpoint đã được kiểm chứng tự động qua:
  - `tests/api-endpoint-audit.test.js` (rà soát public, internal webhook, alternate paths, versioning, path traversal, cross-account isolation & đồng bộ tài liệu).
  - `tests/authorization.test.js`, `tests/sensitive-authorization.test.js`, `tests/admin-api-protection.test.js`.
  - `tests/admin-permissions.test.js`, `tests/sales-permissions.test.js`, `tests/support-permissions.test.js`, `tests/user-permissions.test.js`.
  - `tests/order-idor.test.js`, `tests/profile-idor.test.js`, `tests/address-idor.test.js`.
- Khắc phục phát hiện trong quá trình rà soát:
  - Siết từ chối query parameter không hợp lệ (`?userId=...`) trên `/api/privacy/consents`, `/api/privacy/data-requests`, `/api/privacy/exports`.
  - Khắc phục thiếu truyền `allowedServiceStatuses` vào `backend/routes/admin.js` khi cập nhật trạng thái dịch vụ.
