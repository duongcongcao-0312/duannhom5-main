# Chính sách API Versioning & Deprecation (BN-047)

## 1. Quy ước Versioning & Phạm vi áp dụng
- **Kiểu đánh phiên bản:** URL path prefix `/api/v<major>/*` (`backend/api-versioning.js` — `API_VERSION_POLICY`).
- **Phiên bản hiện hành:** `v1` (`/api/v1/*`), áp dụng cho toàn bộ API nghiệp vụ (`/api/v1/books`, `/api/v1/orders`, `/api/v1/auth/*`, `/api/v1/payments/*`, `/api/v1/services`, `/api/v1/customers/*`, `/api/v1/privacy/*`, `/api/v1/policies/*`, `/api/v1/uploads/*`, `/api/v1/admin/*`, `/api/v1/version`).
- **Endpoint không đánh phiên bản:** các probe vận hành `/health` và `/ready`.
- **Header định danh phiên bản:** mọi phản hồi API đều gắn `X-API-Version: v1` (được expose qua `Access-Control-Expose-Headers`).
- **Phiên bản không hỗ trợ:** mọi tiền tố không thuộc `SUPPORTED_API_VERSIONS` (ví dụ `/api/v2/*`, `/api/v0/*`) bị từ chối ngay với `404 Not Found` (`code: "UNSUPPORTED_API_VERSION"`), không fallback sang phiên bản cũ và không lọt qua lớp phân quyền.

## 2. Quy định tương thích ngược (Backward Compatibility)
- **Thay đổi tương thích ngược (không tăng major):**
  - Thêm endpoint mới.
  - Thêm trường tùy chọn trong request body hoặc query string.
  - Thêm trường mới trong response JSON.
  - Nới lỏng điều kiện kiểm tra đầu vào.
- **Thay đổi phá vỡ hợp đồng (breaking change — bắt buộc mở `/api/v2/*`):**
  - Xóa hoặc đổi tên endpoint, trường response, hoặc giá trị enum hiện hữu.
  - Thay đổi kiểu dữ liệu hoặc ngữ nghĩa của trường đang dùng.
  - Thêm trường bắt buộc mới vào request hiện có.
  - Thay đổi cơ chế xác thực hoặc cấu trúc lỗi chuẩn.

## 3. Chính sách Deprecation & Thời gian hỗ trợ phiên bản cũ
- **Alias tương thích `/api/*`:** các đường dẫn `/api/*` chưa gắn phiên bản tiếp tục ánh xạ sang `v1` trong giai đoạn chuyển tiếp và trả kèm các header chuẩn:
  - `X-API-Version: v1`
  - `Deprecation: true`
  - `Sunset: Thu, 01 Jul 2027 00:00:00 GMT`
  - `Link: </api/v1/...>; rel="successor-version"`
- **Thông báo trước:** tối thiểu **30 ngày** (`deprecationNoticeDays`) trước khi đánh dấu deprecated chính thức.
- **Thời gian hỗ trợ tối thiểu:** phiên bản major cũ và alias `/api/*` được duy trì tối thiểu **180 ngày** (`minSupportWindowDays`) kể từ ngày công bố phiên bản kế nhiệm trước khi ngừng phục vụ.

## 4. Đảm bảo an toàn định tuyến & phân quyền
- `backend/router.js`, `backend/request-limits.js`, `server.js` và `backend/app.js` đều chuẩn hóa đường dẫn qua `resolveApiVersion` trước khi kiểm tra RBAC (`getAdminPermission`), giới hạn kích thước request (`resolveRequestBodyLimit`) và ghi audit log (`auditAdminRequestFailure`).
- Nhờ đó `/api/v1/admin/*` và `/api/admin/*` luôn áp dụng cùng một ma trận quyền, cùng giới hạn dung lượng và cùng cơ chế audit bất biến.
