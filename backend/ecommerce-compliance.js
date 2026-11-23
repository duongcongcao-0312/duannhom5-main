"use strict";

/**
 * Vietnam E-Commerce legal compliance review dossier & public disclosure metadata
 * (BN-201 / issue #178).
 *
 * Preparation artifact only — does not replace official verification with
 * competent authorities (e.g., Ministry of Industry and Trade / online.gov.vn)
 * or qualified legal counsel prior to commercial launch.
 */

const ECOMMERCE_COMPLIANCE = Object.freeze({
  version: "2026-01",
  policyUrl: "/ecommerce-compliance.html",
  jurisdiction: "VN",
  websiteModel: "ecommerce_sales_website",
  websiteModelLabel: "Website thương mại điện tử bán hàng (trực tiếp, không phải sàn trung gian)",
  operatorRole: "direct_seller_and_service_operator",
  goodsAndServices: Object.freeze([
    "retail_books_online",
    "book_rental_service",
    "used_book_buyback_and_exchange",
  ]),
  legalDisclaimer:
    "Đây là hồ sơ chuẩn bị và rà soát tuân thủ nội bộ, không thay thế việc xác nhận nghĩa vụ pháp lý với cơ quan nhà nước có thẩm quyền (Bộ Công Thương, cơ quan thuế) hoặc luật sư chuyên môn trước khi vận hành thương mại chính thức.",
  sections: Object.freeze([
    {
      id: "ecommerceModel",
      title: "Mô hình website, vai trò bên vận hành & phạm vi cung cấp",
      summary:
        "BookNest vận hành theo mô hình website thương mại điện tử bán hàng trực tiếp (bán lẻ sách, cung cấp dịch vụ thuê/thu mua/trao đổi sách), không cho phép bên thứ ba mở gian hàng trung gian.",
    },
    {
      id: "ecommerceObligations",
      title: "Danh mục nghĩa vụ thông báo, đăng ký & công bố thông tin",
      summary:
        "Rà soát nghĩa vụ thông báo website TMĐT bán hàng (online.gov.vn), công bố thông tin chủ sở hữu/ĐKKD/MST/địa chỉ/liên hệ, niêm yết giá và điều kiện giao dịch chung, giao nhận, đổi trả, hoàn tiền, thanh toán và bảo vệ dữ liệu cá nhân.",
    },
    {
      id: "ecommerceVerificationOwners",
      title: "Đầu mối xác minh & quy trình tuân thủ trước khi vận hành chính thức",
      summary:
        "Phân công rõ đầu mối phụ trách (Quản trị vận hành, Pháp lý/Tuân thủ, Kế toán/Thuế, CSKH) và yêu cầu xác nhận từ chuyên gia pháp lý hoặc cơ quan có thẩm quyền trước khi chính thức go-live thương mại.",
    },
    {
      id: "ecommerceDisclosures",
      title: "Bộ chính sách và thông tin công khai bắt buộc",
      summary:
        "Công khai đầy đủ 6 trang chính sách đồng bộ: Điều khoản dịch vụ, Vận chuyển, Đổi trả, Hoàn tiền, Bảo mật dữ liệu cá nhân và Bảo vệ người tiêu dùng – Thuế & Hóa đơn.",
    },
  ]),
  verificationOwners: Object.freeze([
    {
      role: "operations_admin_owner",
      responsibility: "Rà soát thông tin chủ sở hữu website, cấu hình kỹ thuật và điều phối go-live",
      signoffStatus: "pending_prelaunch_signoff",
    },
    {
      role: "legal_compliance_owner",
      responsibility: "Xác nhận nghĩa vụ thông báo website TMĐT bán hàng (online.gov.vn) và điều khoản giao dịch với luật sư/cơ quan có thẩm quyền",
      signoffStatus: "pending_prelaunch_signoff",
    },
    {
      role: "accounting_tax_owner",
      responsibility: "Xác nhận ĐKKD, mã số thuế, chế độ thuế và quy trình xuất hóa đơn điện tử",
      signoffStatus: "pending_prelaunch_signoff",
    },
    {
      role: "customer_support_owner",
      responsibility: "Vận hành kênh tiếp nhận khiếu nại, đổi trả, hoàn tiền và yêu cầu dữ liệu cá nhân",
      signoffStatus: "pending_prelaunch_signoff",
    },
  ]),
  linkedPolicies: Object.freeze({
    terms: "/terms.html",
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
    privacy: "/privacy.html",
    consumerTax: "/consumer-tax.html",
  }),
});

module.exports = {
  ECOMMERCE_COMPLIANCE,
};
