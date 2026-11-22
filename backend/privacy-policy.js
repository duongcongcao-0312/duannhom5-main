"use strict";

/**
 * Public Privacy Policy metadata, data inventory, cookie/analytics disclosure,
 * third-party providers, retention schedule, and data-subject rights
 * (BN-189 / issue #265).
 *
 * Synchronized with actual browser storage, backend storage, Firebase Auth,
 * VietQR, SePay webhook, consent management, profile updates, data export,
 * and DSAR procedures.
 */

const PRIVACY_POLICY = Object.freeze({
  version: "2026-01",
  effectiveDate: "2026-01-01",
  policyUrl: "/privacy.html",
  changeNoticeDays: 7,
  dataInventory: Object.freeze([
    {
      category: "account",
      label: "Tài khoản & xác thực",
      dataItems: Object.freeze([
        "Họ tên",
        "Email đăng nhập",
        "Mật khẩu đã băm (scrypt)",
        "Thông tin phân loại/xác minh học sinh/sinh viên (nếu cung cấp)",
        "Liên kết tài khoản social Google/Facebook (nếu sử dụng)",
        "Phiên đăng nhập (Bearer token)",
      ]),
      purposes: Object.freeze([
        "Tạo và quản lý tài khoản người dùng",
        "Xác thực đăng nhập, khôi phục mật khẩu và bảo vệ phiên",
        "Áp dụng ưu đãi học sinh/sinh viên sau khi xác minh",
      ]),
      recipients: Object.freeze([
        "Hệ thống backend & cơ sở dữ liệu BookNest",
        "Firebase Authentication (khi bật đăng nhập Google/Facebook)",
        "Nhà cung cấp dịch vụ email SMTP (khi gửi email khôi phục mật khẩu)",
      ]),
      retention:
        "Lưu trong thời gian tài khoản hoạt động hoặc đến khi có yêu cầu xóa/ẩn danh hợp lệ; phiên đăng nhập hết hạn sau 8 giờ (refresh tối đa 30 ngày) hoặc khi đăng xuất/thu hồi.",
    },
    {
      category: "order",
      label: "Đơn hàng, giao nhận & thanh toán",
      dataItems: Object.freeze([
        "Tên người nhận, số điện thoại, địa chỉ giao hàng",
        "Danh sách sách, số lượng, mã ưu đãi, tổng tiền",
        "Phương thức thanh toán (chuyển khoản/COD), mã thanh toán BN... và trạng thái thanh toán",
      ]),
      purposes: Object.freeze([
        "Xử lý đơn hàng, đối soát thanh toán và giao nhận",
        "Hỗ trợ đổi trả, hoàn tiền và giải quyết khiếu nại",
        "Thực hiện nghĩa vụ đối soát kế toán và lưu trữ chứng từ",
      ]),
      recipients: Object.freeze([
        "Hệ thống backend & cơ sở dữ liệu BookNest",
        "VietQR (tạo ảnh QR chuyển khoản từ mã ngân hàng, số tài khoản nhận, số tiền và mã BN...)",
        "SePay (webhook đối soát chuyển khoản khi được cấu hình)",
        "Đơn vị vận chuyển và bộ phận CSKH/Bán hàng",
      ]),
      retention:
        "Lưu giữ phục vụ đối soát giao dịch, đổi trả/hoàn tiền và nghĩa vụ kế toán/thuế theo quy định pháp luật hiện hành (đơn đã tạo giữ nguyên thông tin giao hàng tại thời điểm đặt).",
    },
    {
      category: "service_request",
      label: "Yêu cầu dịch vụ sách (thuê, thu mua, trao đổi)",
      dataItems: Object.freeze([
        "Tên người liên hệ",
        "Số điện thoại",
        "Loại dịch vụ, tên sách và ghi chú yêu cầu",
      ]),
      purposes: Object.freeze([
        "Tiếp nhận, tư vấn và thực hiện dịch vụ thuê, thu mua hoặc trao đổi sách",
      ]),
      recipients: Object.freeze([
        "Hệ thống backend & bộ phận hỗ trợ/bán hàng BookNest",
      ]),
      retention:
        "Lưu trong thời gian xử lý yêu cầu và hỗ trợ hậu mãi liên quan hoặc đến khi được xử lý xóa theo quy định áp dụng.",
    },
    {
      category: "privacy_records",
      label: "Bản ghi consent & yêu cầu dữ liệu cá nhân (DSAR)",
      dataItems: Object.freeze([
        "Mục đích consent (order, service, marketing), phiên bản chính sách, trạng thái đồng ý/rút lại, retentionDays",
        "Loại yêu cầu dữ liệu (access, update, export, delete), trạng thái xử lý, kênh tiếp nhận và mã kết quả",
      ]),
      purposes: Object.freeze([
        "Ghi nhận bằng chứng đồng ý/rút lại đồng ý của người dùng",
        "Thực thi và theo dõi SLA xử lý yêu cầu quyền riêng tư",
      ]),
      recipients: Object.freeze([
        "Phụ trách dữ liệu cá nhân / Quản trị viên có quyền read:privacy, write:privacy",
      ]),
      retention:
        "Bản ghi consent có retentionDays > 0 đủ điều kiện dọn dẹp sau khi hết hạn bằng công cụ vận hành (giá trị 0 không tự hết hạn để làm bằng chứng). Tệp xuất JSON tự hủy sau 15 phút.",
    },
    {
      category: "crm_and_audit",
      label: "Hồ sơ CSKH (CRM) & nhật ký kiểm toán",
      dataItems: Object.freeze([
        "Hồ sơ khách hàng CRM và ghi chú tương tác CSKH",
        "Nhật ký kiểm toán quản trị (request ID, route, hành động, người thực hiện; không lưu mật khẩu, token hay giá trị dữ liệu nhạy cảm tự do)",
      ]),
      purposes: Object.freeze([
        "Chăm sóc khách hàng, xử lý khiếu nại và chuyển cấp",
        "Giám sát an ninh hệ thống, phòng chống gian lận và điều tra sự cố",
      ]),
      recipients: Object.freeze([
        "Nhân viên được phân quyền theo ma trận quyền (support, sales, admin)",
      ]),
      retention:
        "Lưu theo chính sách vận hành an ninh và giải quyết tranh chấp; nhật ký kiểm toán áp dụng cơ chế ẩn thông tin nhạy cảm.",
    },
  ]),
  cookiesAndAnalytics: Object.freeze({
    usesAdvertisingCookies: false,
    usesThirdPartyAnalytics: false,
    setsFirstPartyTrackingCookies: false,
    browserStorage: Object.freeze({
      localStorage: Object.freeze([
        "Giỏ hàng",
        "Danh sách sách yêu thích",
        "Mã ưu đãi đang áp dụng",
        "Bản lưu cục bộ dự phòng khi gửi yêu cầu dịch vụ thất bại",
      ]),
      sessionStorage: Object.freeze([
        "Bearer token phiên đăng nhập",
        "Hồ sơ hiển thị của tài khoản đang đăng nhập",
        "Thông tin liên hệ tạm trong phiên",
        "Mã đơn hàng gần nhất vừa đặt",
      ]),
    }),
    thirdPartyAuthNotice:
      "BookNest không sử dụng cookie quảng cáo hoặc công cụ analytics bên thứ ba (như Google Analytics, Facebook Pixel). Chỉ khi bật đăng nhập Google/Facebook, SDK Firebase Authentication (gstatic.com) mới có thể sử dụng bộ nhớ/cookie kỹ thuật của nhà cung cấp để hoàn tất xác thực.",
  }),
  thirdPartyProviders: Object.freeze([
    {
      name: "Firebase Authentication (Google)",
      purpose: "Xác thực đăng nhập Google/Facebook khi được bật; backend xác minh Firebase ID token.",
      sharedData: "Thông tin định danh đăng nhập social và ID token xác thực.",
      optional: true,
    },
    {
      name: "VietQR",
      purpose: "Tạo hình ảnh mã QR chuyển khoản ngân hàng.",
      sharedData: "Mã ngân hàng, số tài khoản nhận, tên tài khoản nhận, số tiền và mã thanh toán BN....",
      optional: false,
    },
    {
      name: "SePay Webhook",
      purpose: "Đối soát tự động giao dịch chuyển khoản ngân hàng khi được cấu hình và xác minh khóa API.",
      sharedData: "Dữ liệu đối soát giao dịch khớp mã thanh toán BN... và số tiền đơn hàng.",
      optional: true,
    },
    {
      name: "Hạ tầng Hosting, Cơ sở dữ liệu (PostgreSQL/File), Email SMTP & Đơn vị vận chuyển",
      purpose: "Lưu trữ vận hành, gửi email thông báo/khôi phục mật khẩu và giao nhận đơn hàng.",
      sharedData: "Dữ liệu tối thiểu cần thiết theo từng nghiệp vụ tương ứng.",
      optional: false,
    },
  ]),
  dataSubjectRights: Object.freeze([
    {
      code: "know_and_consent",
      title: "Quyền được biết, đồng ý và rút lại đồng ý",
      howToExercise: "Quản lý trực tiếp tại mục Quản lý consent trên privacy.html (/api/privacy/consents).",
      slaHours: null,
    },
    {
      code: "access",
      title: "Quyền truy cập dữ liệu cá nhân",
      howToExercise: "Gửi yêu cầu loại access tại privacy.html hoặc qua kênh hỗ trợ quyền riêng tư.",
      slaHours: 48,
    },
    {
      code: "update",
      title: "Quyền chỉnh sửa, cập nhật dữ liệu cá nhân",
      howToExercise: "Tự cập nhật họ tên, SĐT, địa chỉ qua tài khoản (PATCH /api/auth/customer-info) hoặc gửi yêu cầu update cho trường cần xác minh bổ sung.",
      slaHours: 48,
    },
    {
      code: "export",
      title: "Quyền xuất dữ liệu cá nhân (JSON)",
      howToExercise: "Tự tạo và tải tệp UTF-8 JSON tại privacy.html (POST /api/privacy/exports, hiệu lực 15 phút) hoặc gửi yêu cầu export.",
      slaHours: 48,
    },
    {
      code: "delete",
      title: "Quyền yêu cầu xóa / ẩn danh dữ liệu",
      howToExercise: "Gửi yêu cầu loại delete tại privacy.html hoặc qua đầu mối bảo vệ dữ liệu; hệ thống ẩn danh hồ sơ và thu hồi phiên đăng nhập khi hoàn tất.",
      slaHours: 72,
    },
    {
      code: "complaint",
      title: "Quyền khiếu nại, phản ánh",
      howToExercise: "Liên hệ CSKH / đầu mối bảo vệ dữ liệu; chuyển cấp L1 → L2 → L3 theo quy trình DSAR.",
      slaHours: 48,
    },
  ]),
  contactAndChannels: Object.freeze({
    webPortal: "/privacy.html",
    channels: Object.freeze(["web_portal", "email_support", "in_person"]),
    slaHours: Object.freeze({
      access: 48,
      update: 48,
      export: 48,
      delete: 72,
    }),
    escalationLevels: Object.freeze([
      "l1_support",
      "l2_privacy_lead",
      "l3_legal_admin",
    ]),
  }),
  securityMeasures: Object.freeze([
    "Băm mật khẩu một chiều bằng scrypt kèm salt ngẫu nhiên ở backend.",
    "Không thu thập hoặc lưu trữ số thẻ thanh toán; tách biệt khóa bí mật server-side khỏi frontend.",
    "Phân quyền truy cập theo vai trò (RBAC) và kiểm soát quyền read:privacy / write:privacy đối với hàng đợi dữ liệu cá nhân.",
    "Tệp xuất dữ liệu cá nhân yêu cầu xác thực lại, cấp mã tải xuống một lần qua header X-Export-Token và tự hủy sau 15 phút.",
    "Nhật ký kiểm toán ẩn dữ liệu nhạy cảm, không ghi mật khẩu, token hoặc giá trị dữ liệu cá nhân tự do.",
  ]),
  linkedPolicies: Object.freeze({
    terms: "/terms.html",
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
  }),
});

module.exports = {
  PRIVACY_POLICY,
};
