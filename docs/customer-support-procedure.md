# Quy trình chăm sóc khách hàng (BN-205 / Issue #182)

Tài liệu quy định cách tiếp nhận, phân loại, xử lý và lưu vết yêu cầu hỗ trợ
trong vòng đời trước, trong và sau khi mua. Quy trình dưới đây dùng vai trò
ứng dụng hiện có và không gán tên nhân sự chưa được đơn vị vận hành xác nhận.

> **Điều kiện trước khi go-live:** đơn vị vận hành phải công bố kênh chính thức,
> khung giờ phục vụ, mục tiêu phản hồi được phê duyệt, lịch trực và người phụ
> trách theo từng ca. Chưa có thông tin này thì không gọi một kênh hoặc lịch
> chưa xác nhận là kênh chính thức của BookNest.

## 1. Kênh hỗ trợ và người chịu trách nhiệm

| Kênh | Công dụng | Trạng thái triển khai | Tiếp nhận ban đầu |
| --- | --- | --- | --- |
| Yêu cầu dịch vụ qua `POST /api/services` | Thuê, thu mua, trao đổi sách và câu hỏi dịch vụ | Được triển khai | Support |
| Tài khoản khách hàng và tra cứu đơn | Xem đơn thuộc tài khoản, trạng thái thanh toán/xử lý | Được triển khai | Support hướng dẫn; Sales xử lý vận hành đơn |
| Tra cứu đơn bằng mã đơn/UUID | Khách nhận mã truy cập ở luồng đặt hàng khách | Được triển khai; UUID là bí danh, mã truy cập là bí mật tra cứu | Khách tra cứu tự phục vụ; Sales/Admin hỗ trợ kiểm tra có thẩm quyền |
| Hàng đợi tương tác CRM | Ghi nhận và theo dõi chăm sóc theo hồ sơ khách hàng | Được triển khai | Support ghi tương tác; Admin quản trị |
| Email / điện thoại / chat mạng xã hội chính thức | Hỗ trợ trực tiếp do đơn vị vận hành công bố | **Chưa khai báo** | Cần gán kênh và lịch trực trước go-live |

Kênh chính thức chỉ được công bố sau khi:

- Admin xác nhận danh tính đầu mối chịu trách nhiệm cho từng khung giờ.
- Kênh được giám sát trong toàn bộ khung giờ đã công bố.
- Có quy trình chuyển tiếp hoặc báo khách ngoài giờ.
- Bản ghi hỗ trợ có thể truy về mã yêu cầu, mã đơn hoặc tương tác CRM.

### Vai trò và quyền vận hành

- **Support (L1):** tiếp nhận, xác minh thông tin tối thiểu, tra cứu hướng dẫn,
  trả lời câu hỏi thường gặp, ghi tương tác CRM và chuyển cấp.
- **Sales (L2):** xử lý yêu cầu liên quan đơn, trạng thái giao nhận hoặc dịch vụ
  khi vượt khả năng của Support.
- **Admin (L2/L3):** cập nhật đơn/thanh toán theo quyền, quản trị nhân sự và
  CRM, xử lý dữ liệu cá nhân hoặc quyết định cần phê duyệt.
- **Phụ trách dữ liệu / pháp lý:** xử lý DSAR, tranh chấp bảo mật hoặc nghĩa vụ
  lưu trữ theo quy trình [xử lý dữ liệu cá nhân](privacy-request-procedure.md).

Support không được tạo/cập nhật/xóa hồ sơ CRM, cập nhật trạng thái/thông tin
đơn, thay đổi giá/catalog/coupon hoặc truy cập dữ liệu của khách khác ngoài
phạm vi yêu cầu được xác minh. Support chỉ được đọc và tạo tương tác CRM; thao
tác cập nhật/xóa tương tác thuộc Sales/Admin theo quyền hiện có.

## 2. Giờ phục vụ, mục tiêu phản hồi và trực

Khung giờ thực tế và người trực không được suy diễn. Trước khi công bố, Admin
phải điền vào bảng lịch trực:

| Thông tin cần xác nhận | Trường vận hành bắt buộc |
| --- | --- |
| Ngày và giờ phục vụ theo múi giờ Việt Nam | Cần xác nhận |
| Kênh nào giám sát trong từng khung giờ | Cần xác nhận |
| Nhân sự trực theo vai trò Support/Sales/Admin | Cần xác nhận |
| Kênh thay thế khi hết ca | Cần xác nhận |
| Thời điểm đóng ca và bàn giao yêu cầu chưa kết thúc | Cần xác nhận |

Cho đến khi đơn vị phê duyệt số liệu riêng, dùng mục tiêu đề xuất sau làm ngưỡng
nội bộ; đây không phải cam kết công khai:

| Mức ưu tiên | Ví dụ | Phản hồi đầu tiên đề xuất | Kết thúc hoặc chuyển cấp đề xuất |
| --- | --- | --- | --- |
| P1 — Chặn giao dịch / rủi ro cao | Lộ dữ liệu, thanh toán bị nghi ngờ, tài khoản bị chiếm dụng | Trong 30 phút khi đang trực | Chuyển Admin ngay; cập nhật liên tục |
| P2 — Ảnh hưởng đơn hàng lớn | Đơn trùng, thanh toán không khớp, giao hàng sai | Trong 2 giờ làm việc | Chuyển Sales/Admin trong 4 giờ làm việc |
| P3 — Câu hỏi hoặc lỗi thường gặp | Hướng dẫn tra cứu, thay đổi thông tin, sản phẩm còn hàng | Trong 1 ngày làm việc | Giải quyết hoặc chuyển cấp trong 2 ngày làm việc |
| P4 — Yêu cầu chỉ mang tính tư vấn | Gợi ý sách, trao đổi dịch vụ không khẩn | Trong 2 ngày làm việc | Phản hồi trong 3 ngày làm việc |

Mục tiêu phản hồi là từ lúc hệ thống ghi nhận đến lúc khách nhận tin xác nhận
có người xử lý. Nó không tính thời gian chờ bên vận chuyển, cổng thanh toán,
đơn vị pháp lý hoặc xác minh bổ sung. Admin phải cập nhật bảng này bằng SLA đã
duyệt trước khi công khai cam kết.

## 3. Quy trình tiếp nhận và tra cứu

1. Ghi nhận kênh, thời gian, mã yêu cầu hoặc mã đơn, loại câu hỏi và mức ưu tiên.
2. Xác nhận tối thiểu: loại yêu cầu và thông tin định danh phù hợp. Với đơn tài
   khoản, dùng phiên đăng nhập hợp lệ; với đơn khách, yêu cầu khách thực hiện
   tra cứu bằng UUID và mã truy cập do luồng đặt hàng cấp.
3. Yêu cầu chỉ dữ liệu cần thiết để xác minh; không yêu cầu mật khẩu, mã OTP,
   token, cccd/kết quả thanh toán đầy đủ hoặc ảnh thẻ thanh toán.
4. Khi khách đã đăng nhập, hướng dẫn chủ tài khoản tra cứu chính đơn của họ;
   Support không có quyền đọc đơn của khách hoặc hồ sơ của khách khác.
5. Khi là đơn khách, hướng dẫn khách dùng UUID và `X-Order-Access-Code` do luồng
   đặt hàng cung cấp tại `GET /api/orders/:id/status`. UUID không thay thế mã truy cập
   và không phải bằng chứng ủy quyền cho nhân viên Support.
   Support không giữ/mượn mã truy cập hay thực hiện tra cứu thay khách.
6. Với yêu cầu dịch vụ, tìm mã yêu cầu trong hàng đợi `GET /api/admin/services`
   và đối chiếu trạng thái; Support có thể đọc/cập nhật trạng thái dịch vụ.
7. Ghi rõ kết quả tra cứu là đơn nào, trạng thái đơn hiện tại, trạng thái thanh toán
   nếu được phép xem và bước tiếp theo; không suy đoán hoặc hứa thay đổi quyền.

Các trạng thái vận hành đơn hợp lệ là `received`, `processing`, `shipping`,
`completed` và `cancelled`. `paymentStatus` là trạng thái riêng. Support không
được thay đổi hai loại trạng thái này; Sales chỉ có thể cập nhật luồng đơn,
không được xác nhận thanh toán.

## 4. Hướng dẫn câu hỏi thường gặp

| Chủ đề | Hành động hướng dẫn |
| --- | --- |
| Thêm/cập nhật giỏ hàng | Hướng dẫn khách kiểm tra giỏ trên trình duyệt; không tự truy cập hoặc sửa giỏ của tài khoản khác |
| Cách đặt hàng/COD/chuyển khoản QR | Hướng dẫn theo cấu hình trang thanh toán và không yêu cầu gửi ảnh thẻ hoặc mật khẩu |
| Tra cứu đơn | Chủ tài khoản tra cứu bằng phiên đăng nhập; đơn khách tự tra cứu bằng UUID và mã truy cập. Support không dùng tên/điện thoại hoặc UUID đơn độc lập để xem đơn |
| Thay đổi địa chỉ/kích hoạt hủy | Kiểm tra trạng thái đơn; Support ghi nhận và chuyển Sales/Admin. Không hứa đổi nếu đơn đã bàn giao hoặc đã hoàn tất |
| Giao hàng chậm/thất bại | Đối chiếu quy trình giao nhận và phản hồi theo chính sách công khai; chuyển Sales/Admin nếu cần cập nhật trạng thái |
| Hoàn trả/hoàn tiền | Hướng dẫn theo chính sách `refund.html`/`returns.html`; không tự ra quyết định hoặc xác nhận thanh toán |
| Cập nhật hồ sơ/địa chỉ | Hướng dẫn khách dùng luồng tự phục vụ hoặc yêu cầu dữ liệu cá nhân nếu vượt quyền |
| Rò rỉ dữ liệu, ẩn danh, truy xuất dữ liệu | Chuyển ngay quy trình DSAR và Phụ trách dữ liệu; không trao dữ liệu qua kênh hỗ trợ không xác minh |
| Sách/hóa đơn/ưu đãi | Kiểm tra tài liệu công khai và chuyển Admin/Sales; Support không đổi giá, coupon hoặc số thuế |

Khi không có hướng dẫn cụ thể, không dùng thông tin suy đoán. Ghi lại câu hỏi,
dữ liệu đã kiểm tra, nguồn chính sách tham chiếu và phần chưa thể xác định.

## 5. Phân loại, chuyển cấp và lưu vết

Mỗi yêu cầu phải có các trường nội bộ sau:

- `channel`: kênh tiếp nhận thực tế.
- `category`: order, payment, shipping, service, account, privacy, refund,
  catalog hoặc other.
- `priority`: P1, P2, P3 hoặc P4.
- `customerReference`: mã khách hoặc mã đơn/UUID được xác minh; không ghi mật khẩu.
- `owner`: vai trò đang phụ trách.
- `status`: open, waiting_customer, waiting_third_party, escalated hoặc resolved.
- `dueAt`: thời điểm cần phản hồi theo mục tiêu đã phê duyệt.
- `escalationLevel`: support_l1, sales_l2, admin_l2, admin_l3 hoặc privacy_lead.
- `resolutionCode`: số lần thử, kết quả đã xác minh hoặc lý do không xử lý.
- `nextAction`: hành động cụ thể và người phụ trách tiếp theo.

### Quy tắc chuyển cấp

- P1: chuyển Admin ngay; ghi liên tục, không chờ phiên đóng ca.
- Vấn đề đơn/giao nhận: Support → Sales; Sales không xác nhận thanh toán.
- Thay đổi thanh toán/hoàn tiền/hủy đơn đã thanh toán: Sales/Admin → Admin.
- Hồ sơ, dữ liệu cá nhân, rút consent hoặc ẩn danh: Phụ trách dữ liệu/Admin.
- Tranh chấp pháp lý, lưu trữ hoặc yêu cầu cơ quan: Admin/L3 hoặc đầu mối pháp lý.
- Khi người nhận bàn giao không thể xử lý, Support giữ yêu cầu ở trạng thái
  `escalated`, ghi lý do và thời điểm bàn giao.

## 6. Ghi tương tác CRM và bảo vệ dữ liệu

Support xem hồ sơ CRM và tương tác qua API được phép; có thể tạo bản ghi
`POST /api/admin/customers/:id/interactions` với `type: "support"` và ghi chú
tối đa 2.000 ký tự. Không ghi:

- mật khẩu, mã OTP, token phiên, thẻ thanh toán, cccd hoặc tài liệu căn cước;
- URL chứa token/mã bí mật; nội dung export hoặc dữ liệu cá nhân khác;
- toàn bộ địa chỉ, email hoặc số điện thoại nếu không cần đối chiếu;
- ý kiến chủ quan chưa kiểm chứng hoặc dữ liệu nhạy cảm không liên quan yêu cầu.

Ghi chú phải ngắn gọn, có thời gian do server thiết lập, người tạo do server lấy
từ phiên xác thực và không nhận thông tin người thực hiện từ payload.
Tương tác không thay thế yêu cầu dữ liệu, yêu cầu hoàn tiền, khiếu nại hoặc
journal riêng của đơn; khi có quy trình chuyên biệt, tham chiếu mã/quyết định
chuyên biệt thay vì sao chép dữ liệu cá nhân vào CRM.

## 7. Đồng bộ trước, trong và sau khi mua

- **Trước mua:** giải thích sản phẩm chính sách công khai, liên kết giao nhận,
  đổi/trả, hoàn tiền, bảo mật và điều khoản; không cam kết ngoài chính sách.
- **Trong mua:** xác nhận đơn, hướng dẫn thanh toán, cập nhật trạng thái, mã đơn
  và bước tiếp theo; không xác nhận thanh toán ngoài luồng được quyền.
- **Sau mua:** hướng dẫn nhận hàng, khiếu nại giao nhận, đổi/trả/hoàn tiền,
  lưu vết tương tác và hỏi phản hồi cải thiện khi yêu cầu đã kết thúc.

Yêu cầu đã đóng phải ghi `resolutionCode`, kết quả đã thông báo cho khách và
hành động tiếp theo cuối cùng. Không tự xóa tương tác; chỉ Admin có quyền xóa
theo quy trình quản trị dữ liệu.

## 8. Danh sách kiểm tra trước go-live

- [ ] Công bố ít nhất một kênh chính thức có giám sát trong giờ phục vụ.
- [ ] Gán người phụ trách và lịch trực theo vai trò Support/Sales/Admin.
- [ ] Phê duyệt khung giờ, mục tiêu phản hồi và quy tắc đóng ca/bàn giao.
- [ ] Kiểm tra nhân viên Support có quyền đọc/cập nhật dịch vụ, đọc CRM và tạo tương tác.
- [ ] Kiểm tra Support bị từ chối truy cập/ghi nhận ngoài phạm vi: đơn khách khác,
  hồ sơ/địa chỉ khác, export/privacy, catalog, coupon, staff và audit.
- [ ] Kiểm tra hướng dẫn tra cứu có mã đơn/UUID và không lộ dữ liệu không thuộc tài khoản.
- [ ] Kiểm tra mẫu ghi tương tác không chứa mật khẩu, token, dữ liệu thẻ hoặc PII thừa.
- [ ] Liên kết SOP này với chính sách giao nhận, đổi/trả, hoàn tiền và DSAR.
