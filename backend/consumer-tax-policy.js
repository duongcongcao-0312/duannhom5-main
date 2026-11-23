"use strict";

/**
 * Consumer protection, tax, and invoicing compliance review & public policy metadata
 * (BN-202 / issue #179).
 *
 * Note: This module documents operational policies and compliance checkpoints only;
 * it is not legal or tax advice and must be confirmed with qualified legal/accounting
 * advisors or competent authorities prior to commercial launch.
 */

const CONSUMER_TAX_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/consumer-tax.html",
  currency: "VND",
  complaintResponseBusinessDays: 2,
  returnWindowDays: 7,
  refundBusinessDays: "3-5",
  accountingRecordRetentionYears: 10,
  legalDisclaimer:
    "Nội dung này là kết quả rà soát vận hành và không phải ý kiến tư vấn pháp lý hay thuế. Đơn vị vận hành cần xác nhận với chuyên gia kế toán/pháp lý hoặc cơ quan nhà nước có thẩm quyền trước khi kinh doanh chính thức.",
  sections: Object.freeze([
    {
      id: "consumerPricingTerms",
      title: "Minh bạch giá bán, phí & điều kiện giao dịch",
      summary:
        "Giá bán niêm yết bằng VND, chiết khấu thành viên/sinh viên, mã ưu đãi và phí vận chuyển (miễn phí từ 300.000 đ) được hệ thống backend tính và hiển thị rõ trước khi khách xác nhận đặt hàng.",
    },
    {
      id: "consumerSupportRefunds",
      title: "Hỗ trợ khách hàng, khiếu nại, đổi trả & hoàn tiền",
      summary:
        "CSKH tiếp nhận và phản hồi khiếu nại trong tối đa 2 ngày làm việc, áp dụng đổi trả trong 7 ngày (/returns.html) và hoàn tiền trong 3–5 ngày làm việc (/refund.html) có theo dõi trên CRM và audit log.",
    },
    {
      id: "taxInvoiceObligations",
      title: "Nghĩa vụ thuế, chứng từ & hóa đơn điện tử theo mô hình kinh doanh",
      summary:
        "Đối chiếu hoạt động bán lẻ sách, thuê, thu mua và trao đổi sách với nghĩa vụ đăng ký kinh doanh, thuế GTGT/TNDN/TNCN và phát hành hóa đơn điện tử theo quy định hiện hành sau khi xác nhận với đơn vị kế toán/cơ quan thuế.",
    },
    {
      id: "accountingLegalWorkflow",
      title: "Quy trình phối hợp kế toán/pháp lý & lưu trữ hồ sơ",
      summary:
        "Phân tách vai trò CSKH tiếp nhận yêu cầu hóa đơn/khiếu nại, Sales đối soát đơn và Admin xuất sổ đối chiếu đơn hàng/thanh toán cho bộ phận kế toán; lưu giữ chứng từ đơn hàng và thanh toán tối thiểu theo thời hạn luật kế toán (kể cả khi tài khoản được ẩn danh theo DSAR).",
    },
  ]),
  invoiceRequestFields: Object.freeze([
    "orderId",
    "buyerNameOrCompany",
    "taxCode",
    "billingAddress",
    "invoiceEmail",
  ]),
  linkedPolicies: Object.freeze({
    terms: "/terms.html",
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
    privacy: "/privacy.html",
  }),
});

module.exports = {
  CONSUMER_TAX_POLICY,
};
