# Chính sách Chuẩn hóa Validation Dữ liệu Đầu vào API (BN-046)

## 1. Quy tắc xác thực thống nhất
Mọi payload JSON và query parameter đi qua bộ xác thực tập trung `backend/validation.js` (`PAYLOAD_SCHEMAS`, `validateJsonPayload`, `validateQueryParams`):
- **Schema tập trung theo từng endpoint:** xác định rõ danh sách trường cho phép (`allowed`), trường bắt buộc (`required`), số trường tối thiểu cho cập nhật (`minProperties`), kiểu dữ liệu (`string`, `number` hữu hạn, `integer` an toàn, `boolean`, `array`, `object`), biên độ dài (`minLength`, `maxLength`), biên số học (`min`, `max`), biên mảng (`minItems`, `maxItems`), định dạng (`pattern`) và tập giá trị cho phép (`enum`).
- **Từ chối trường ngoài dự kiến & prototype pollution:** bất kỳ khóa nào nằm ngoài `allowed` hoặc chứa `__proto__`, `constructor`, `prototype` (kể cả trong object lồng nhau) đều bị từ chối ngay với `400 Bad Request` trước khi xử lý hay ghi dữ liệu.
- **Bảo vệ trường nhạy cảm:** các trường như `password`, `currentPassword`, `token`, `idToken`, `accessCode` được giữ nguyên vẹn khi kiểm tra (`preserveStrings`) nhưng **không bao giờ** bị phản hồi lại giá trị thô trong thông báo lỗi hoặc `details`.

## 2. Cấu trúc lỗi chuẩn đồng bộ với OpenAPI
Mọi lỗi validation trả HTTP `400 Bad Request` theo schema `Error` trong `docs/openapi.json`:
```json
{
  "error": "Dữ liệu yêu cầu không hợp lệ.",
  "code": "VALIDATION_ERROR",
  "details": [
    { "field": "unexpectedField", "reason": "unexpected_field" }
  ]
}
```
- `code`: `"VALIDATION_ERROR"`
- `details`: mảng `{ field, reason }` gồm các mã lý do chuẩn (`expected_object`, `forbidden_key`, `unexpected_field`, `required`, `min_properties`, `invalid_type`, `min_length`, `max_length`, `invalid_format`, `min_value`, `max_value`, `min_items`, `max_items`, `invalid_enum`, `unexpected_query_param`, `duplicate_query_param`, `invalid_integer`, `out_of_range`).
- Không bao giờ để input sai gây lỗi `500` hoặc làm thay đổi dữ liệu trong kho lưu trữ.
