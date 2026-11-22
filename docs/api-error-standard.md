# Chuẩn hóa Phản hồi Lỗi API (BN-045)

## 1. Cấu trúc payload lỗi thống nhất
Mọi lỗi từ `/api/*` và `/api/v1/*` được chuẩn hóa qua `backend/api-errors.js` (`buildApiErrorPayload`) và khớp với schema `Error` trong `docs/openapi.json`:
```json
{
  "error": "Thông báo lỗi an toàn cho client.",
  "code": "NOT_FOUND",
  "requestId": "00000000-0000-4000-8000-000000000001"
}
```
- `error` *(bắt buộc)*: thông báo ngắn gọn bằng tiếng Việt, không chứa chi tiết nội bộ.
- `code` *(bắt buộc)*: mã lỗi máy đọc được ánh xạ theo status code hoặc mã nghiệp vụ (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `CONFLICT`, `GONE`, `PAYLOAD_TOO_LARGE`, `URI_TOO_LONG`, `UNSUPPORTED_MEDIA_TYPE`, `PRECONDITION_REQUIRED`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`).
- `requestId` *(bắt buộc)*: correlation ID an toàn trùng khớp với header `X-Request-Id` để đối chiếu log nội bộ.
- `details` *(tùy chọn, chỉ trên `400 VALIDATION_ERROR`)*: danh sách `{ field, reason }` không chứa giá trị thô.
- `maxBytes` *(tùy chọn, chỉ trên `413`/`414`)*: giới hạn byte tối đa.

## 2. Chống rò rỉ dữ liệu nhạy cảm & chi tiết nội bộ
- **Lỗi `500`:** luôn trả thông báo chung `"Máy chủ gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau."`; chi tiết lỗi và stack trace chỉ ghi vào log máy chủ đã lọc (`logRequestError` + `redactLogText`).
- **Bộ lọc phòng thủ `containsSensitiveOrInternalDetail`:** tự động chặn mọi thông điệp chứa câu lệnh SQL (`SELECT`, `INSERT`, `relation`, `constraint`, `duplicate key`), mã lỗi hệ thống (`ECONNREFUSED`, `ENOENT`), stack trace, đường dẫn tệp máy chủ, chuỗi kết nối DB, private key, Bearer/Apikey/JWT token, email hoặc số điện thoại cá nhân.

## 3. Correlation ID an toàn (`X-Request-Id`)
- `resolveCorrelationId` chấp nhận `X-Request-Id` hợp lệ (`<= 128` ký tự, chỉ gồm `[A-Za-z0-9._:-]`).
- Tự động cấp UUID mới nếu `X-Request-Id` không hợp lệ hoặc trùng với thông tin xác thực (`Authorization` Bearer/Apikey, `X-Order-Access-Code`, `X-Export-Token`, `X-BookNest-Signature` hoặc JWT `eyJ...`).
