-- Synthetic CRM fixtures only; never put real customer data in this file.
-- Apply after customer-schema.sql with:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data/customer-seed.sql

BEGIN;

INSERT INTO customers (
    customer_id, full_name, gender, dob, phone, email, address, city, country,
    source, status, created_by, updated_by
) VALUES
    ('10000000-0000-4000-8000-000000000001', 'Khách hàng mẫu 01', 'other', NULL, '+84000000001', 'crm-demo-01@example.com', 'Địa chỉ mẫu 01', 'Hà Nội', 'Vietnam', 'web', 'new', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000002', 'Khách hàng mẫu 02', 'female', '1998-02-10', '+84000000002', 'crm-demo-02@example.com', 'Địa chỉ mẫu 02', 'Hồ Chí Minh', 'Vietnam', 'admin', 'lead', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000003', 'Khách hàng mẫu 03', 'male', '1995-07-21', '+84000000003', 'crm-demo-03@example.com', 'Địa chỉ mẫu 03', 'Đà Nẵng', 'Vietnam', 'web', 'customer', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000004', 'Khách hàng mẫu 04', 'other', NULL, '+84000000004', 'crm-demo-04@example.com', 'Địa chỉ mẫu 04', 'Cần Thơ', 'Vietnam', 'api', 'new', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000005', 'Khách hàng mẫu 05', 'prefer_not_to_say', '2001-11-05', '+84000000005', 'crm-demo-05@example.com', 'Địa chỉ mẫu 05', 'Hải Phòng', 'Vietnam', 'web', 'lead', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000006', 'Khách hàng mẫu 06', 'female', '1999-04-16', '+84000000006', 'crm-demo-06@example.com', 'Địa chỉ mẫu 06', 'Huế', 'Vietnam', 'admin', 'customer', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000007', 'Khách hàng mẫu 07', 'male', '1992-09-30', '+84000000007', 'crm-demo-07@example.com', 'Địa chỉ mẫu 07', 'Nha Trang', 'Vietnam', 'web', 'new', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000008', 'Khách hàng mẫu 08', 'other', NULL, '+84000000008', 'crm-demo-08@example.com', 'Địa chỉ mẫu 08', 'Đà Lạt', 'Vietnam', 'api', 'lead', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000009', 'Khách hàng mẫu 09', 'female', '2000-01-12', '+84000000009', 'crm-demo-09@example.com', 'Địa chỉ mẫu 09', 'Vũng Tàu', 'Vietnam', 'web', 'customer', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000010', 'Khách hàng mẫu 10', 'male', '1997-06-03', '+84000000010', 'crm-demo-10@example.com', 'Địa chỉ mẫu 10', 'Quy Nhơn', 'Vietnam', 'admin', 'new', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000011', 'Khách hàng mẫu 11', 'prefer_not_to_say', NULL, '+84000000011', 'crm-demo-11@example.com', 'Địa chỉ mẫu 11', 'Biên Hòa', 'Vietnam', 'web', 'lead', 'seed', 'seed'),
    ('10000000-0000-4000-8000-000000000012', 'Khách hàng mẫu 12', 'other', '2002-12-24', '+84000000012', 'crm-demo-12@example.com', 'Địa chỉ mẫu 12', 'Buôn Ma Thuột', 'Vietnam', 'api', 'customer', 'seed', 'seed')
ON CONFLICT DO NOTHING;

INSERT INTO customer_interactions (id, customer_id, type, note, created_by) VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'chat', 'Trao đổi mẫu về danh mục sách.', 'seed'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'call', 'Cuộc gọi chăm sóc mẫu.', 'seed'),
    ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'order', 'Ghi nhận đơn hàng mẫu.', 'seed')
ON CONFLICT DO NOTHING;

COMMIT;
