# Phân trang API

Các endpoint danh sách trả về **mảng JSON** để giữ tương thích với frontend hiện tại. Metadata được trả trong header `X-Pagination`:

```json
{
  "page": 1,
  "limit": 50,
  "total": 123,
  "totalPages": 3,
  "sort": "createdAt",
  "order": "desc"
}
```

Query chung:

- `page`: số trang, từ `1` đến `10000`, mặc định `1`.
- `limit`: số bản ghi, từ `1` đến `100`, mặc định `50` (CRM mặc định `20`).
- `order`: `asc` hoặc `desc`, mặc định `desc`.
- `sort`: chỉ các giá trị được liệt kê cho từng endpoint; giá trị khác bị từ chối với `400`.

Endpoint:

| Endpoint | Sort được hỗ trợ | Quyền |
| --- | --- | --- |
| `GET /api/books` | `title`, `price`, `category` | Công khai |
| `GET /api/orders` | `createdAt`, `status`, `total` | Người dùng đã đăng nhập; chỉ thấy đơn của mình |
| `GET /api/admin/orders` | `createdAt`, `status`, `total` | `read:orders` |
| `GET /api/admin/users` | `createdAt`, `name`, `role` | `read:users` |
| `GET /api/admin/books` | `title`, `price`, `category` | `read:books` |
| `GET /api/admin/services` | `createdAt`, `status`, `service` | `read:services` |
| `GET /api/admin/coupons` | `code`, `expiresAt`, `usedCount` | `read:coupons` |
| `GET /api/customers` và `/api/admin/customers` | `createdAt`, `name`, `status` | Quyền CRM |

Sắp xếp có tie-breaker ổn định theo ID (hoặc `orderId`/`title`) để kết quả giữa các trang không bị xáo trộn khi các bản ghi có cùng giá trị sort. Query lặp, query không hỗ trợ, số trang vượt giới hạn hoặc `limit > 100` trả lỗi `400`.

Hợp đồng đầy đủ nằm tại [openapi.json](./openapi.json). Version API hiện giữ nguyên `/api`; thay đổi này chỉ bổ sung query và response header, không tạo version mới để tránh phá vỡ frontend.
