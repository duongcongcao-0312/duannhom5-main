# Chính sách Không Tin Tưởng Dữ liệu Danh tính, Quyền và Giá từ Frontend (BN-043)

## 1. Danh tính & Quyền (`userId`, `role`)
- Mọi endpoint xác định `userId` và `role` **duy nhất** từ phiên đăng nhập đã xác minh (`getAuthUser` / `authenticate` / `requireRole`) hoặc token đã ký/xác minh (`verifySocialIdentity`).
- Mọi trường giả mạo từ client (`userId`, `ownerId`, `subjectId`, `role`, `isAdmin`, `permissions`, `studentVerificationStatus`) trên các API đăng ký, cập nhật hồ sơ, tạo/cập nhật đơn hàng, dịch vụ và quyền riêng tư đều bị từ chối với `400 VALIDATION_ERROR` hoặc `403 VERIFICATION_REQUIRED`.
- `POST /api/v1/admin/staff` chỉ cho phép admin tạo nhân viên vai trò `sales` hoặc `support` (chặn tự nâng lên `admin`).

## 2. Giá, Chiết khấu & Tổng tiền (`price`, `subtotal`, `discount`, `total`, `totalAmount`)
- `POST /api/v1/orders/quote`, `POST /api/v1/orders` và `PATCH /api/v1/orders/:id`:
  - Trường `totalAmount` không được chấp nhận (từ chối `400 VALIDATION_ERROR`).
  - Các trường tương thích ngược (`price`, `lineTotal`, `subtotal`, `discount`, `total`, `discountRate`) nếu client gửi kèm đều bị **bỏ qua hoàn toàn**; backend luôn tính lại từ catalog sách phía server, kiểm tra tồn kho, xác minh trạng thái sinh viên từ phiên và đối chiếu coupon từ cơ sở dữ liệu.
- `POST /api/v1/services` chỉ ghi các trường đã lọc sạch và gắn `userId` từ phiên đã xác minh (không spread trực tiếp `payload`).
