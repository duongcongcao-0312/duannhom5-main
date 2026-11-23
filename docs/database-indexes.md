# Chiến lược Index & Đánh giá Hiệu năng Truy vấn (`BN-006`)

## 1. Danh mục truy vấn thường xuyên & Index mục tiêu

| Truy vấn thường xuyên | Điều kiện lọc / Join / Sắp xếp | Index sử dụng | Ghi chú chi phí ghi & lưu trữ |
| --- | --- | --- | --- |
| Đăng nhập / tra cứu tài khoản (`findUserByEmail`) | `WHERE lower(email) = $1 LIMIT 1` | `idx_app_users_lower_email` (UNIQUE) | Chi phí ghi thấp (chỉ cập nhật khi tạo/đổi email), chặn trùng email không phân biệt hoa/thường. |
| Đọc danh mục sách tùy chỉnh (`readRelationalCollection("books")`) | `WHERE is_custom = TRUE ORDER BY created_at` | `idx_store_products_custom_created` (Partial) | Partial index chỉ lập chỉ mục sách tùy chỉnh, kích thước rất nhỏ. |
| Liệt kê đơn hàng theo thời gian & đối soát thanh toán | `ORDER BY created_at DESC`, `WHERE payment_status = $1 ORDER BY created_at DESC` | `idx_store_orders_created_at`, `idx_store_orders_payment_status_created` | B-tree gọn (2 cột), tăng tốc trang quản trị đơn hàng và đối soát. |
| Chi tiết dòng sản phẩm đơn hàng (`LEFT JOIN LATERAL`) | `WHERE order_id = orders.order_id` | PK `(order_id, product_title)` + `idx_store_order_items_product_title` | Tận dụng sẵn khóa chính ghép, không tạo index thừa. |
| Danh sách khách hàng CRM đang hoạt động | `WHERE is_active = TRUE AND status = $1 ORDER BY created_at DESC` | `idx_customers_active_status_created` (Partial) | Partial index bỏ qua khách hàng đã xóa mềm (`is_active = FALSE`). |
| Dọn bản ghi consent hết hạn (`pruneExpiredConsentRecords`) | `WHERE retain_until <= $1` | `idx_privacy_consents_retain_until` | Tránh Seq Scan khi job retention chạy định kỳ. |

## 2. Quy trình kiểm chứng bằng `EXPLAIN (ANALYZE, BUFFERS)`

Trước và sau khi áp dụng `data/migrations/022_query_performance_indexes.sql`, chạy kiểm tra kế hoạch thực thi trên staging/production snapshot:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM app_users WHERE lower(email) = 'user@example.com' LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM store_products WHERE is_custom = TRUE ORDER BY created_at;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM store_orders WHERE payment_status = 'pending' ORDER BY created_at DESC LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM customers WHERE is_active = TRUE AND status = 'active' ORDER BY created_at DESC LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)::int FROM privacy_consents WHERE retain_until <= NOW();
```

## 3. Đánh giá chi phí ghi & kích thước index

- Ưu tiên **partial index** (`WHERE is_custom = TRUE`, `WHERE is_active = TRUE`) để giảm kích thước index trên đĩa và giảm số lần cập nhật B-tree khi ghi.
- Không thêm index trên các cột có độ phân biệt rất thấp đứng một mình hoặc cột văn bản dài (`note`, `description`).
- Định kỳ kiểm tra kích thước & tần suất dùng index qua `pg_stat_user_indexes` (`idx_scan`, `pg_relation_size(indexrelid)`) để loại bỏ index không còn sử dụng.

## Issue #333: grouped join for order lists

`readRelationalCollection("orders")` loads the full order list and its line items. The former query used `LEFT JOIN LATERAL` to look up items separately for each order. The updated query groups line items by `order_id` in one subquery and joins that result to orders. Item ordering by `product_title`, order ordering by `created_at`, and the returned JSON shape are preserved. A regression test ensures the path remains a single grouped-join query.

Measure both query forms on staging with representative data using `EXPLAIN (ANALYZE, BUFFERS)`; record execution time, shared hit/read blocks, and actual row counts. This workspace has no access to a staging or production database, so before/after benchmark measurements could not be captured here and the performance gain still needs confirmation against representative data.

## Issue #334: remove a redundant order index

Migration `025_remove_redundant_order_index.sql` drops `idx_store_orders_payment_status` only when `idx_store_orders_payment_status_created` exists. The composite index starts with `payment_status`, so it serves equality filters on that column and additionally supports ordering by `created_at`; removing the single-column index preserves query semantics while reducing duplicate index storage and write maintenance. The migration does not touch table data and guards the drop for schemas without the replacement index.

The repository has no representative PostgreSQL connection, so index usage (`pg_stat_user_indexes`), size (`pg_relation_size`), query latency, and write impact could not be measured here. Before production rollout, compare those metrics on staging and confirm the composite index is used for payment status filters; retain the single-column index if workload-specific evidence shows a material benefit.
