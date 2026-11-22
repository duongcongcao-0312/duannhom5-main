"use strict";

/**
 * Public return & exchange policy and eligibility evaluator (BN-192 / issue #268).
 *
 * Synchronized with refund policy (`backend/refund-policy.js`), complaint handling
 * (CSKH CRM interactions), and consumer protection disclosure before purchase.
 */

const RETURN_REASONS = Object.freeze([
  "defective_or_damaged",
  "wrong_or_missing_item",
  "change_of_mind",
]);

const RETURN_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/returns.html",
  refundPolicyUrl: "/refund.html",
  returnWindowDays: 7,
  reviewBusinessDays: 2,
  exchangeDispatchBusinessDays: { min: 2, max: 3 },
  bookConditionRequirements: Object.freeze([
    "Sách còn nguyên trạng, chưa qua sử dụng, không rách, không ướt, không cong gáy hoặc viết vẽ.",
    "Đầy đủ phụ kiện, quà tặng kèm (bookmark, hộp bọc, phụ bản) như khi giao hàng.",
    "Với trường hợp lỗi in ấn hoặc hư hỏng do vận chuyển, giữ nguyên hiện trạng khi mở hộp để đối chiếu.",
  ]),
  requiredEvidence: Object.freeze([
    "Mã đơn hàng (UUID) và thông tin người nhận để đối chiếu quyền sở hữu đơn.",
    "Hình ảnh rõ nét tình trạng sách/lỗi in ấn và/hoặc video mở hộp (bắt buộc với trường hợp thiếu sách hoặc hư hỏng do vận chuyển).",
  ]),
  eligibleCases: Object.freeze([
    {
      code: "defective_or_damaged",
      title: "Sách lỗi in ấn hoặc hư hỏng do vận chuyển",
      windowDays: 7,
      shippingPaidBy: "booknest",
      resolutionOptions: ["exchange", "refund_100"],
    },
    {
      code: "wrong_or_missing_item",
      title: "Giao sai tựa sách, sai phiên bản hoặc thiếu số lượng",
      windowDays: 7,
      shippingPaidBy: "booknest",
      resolutionOptions: ["exchange_or_reship", "refund_100"],
    },
    {
      code: "change_of_mind",
      title: "Khách đổi ý hoặc đặt nhầm (sách còn nguyên trạng)",
      windowDays: 7,
      shippingPaidBy: "customer",
      resolutionOptions: ["exchange", "refund_item_only"],
    },
  ]),
  ineligibleCases: Object.freeze([
    "Yêu cầu gửi quá 7 ngày kể từ ngày nhận hàng (trừ lỗi phát sinh từ phía BookNest).",
    "Sách đã qua sử dụng, gấp trang, viết vẽ, rách, ướt hoặc thiếu phụ kiện đi kèm (trong trường hợp đổi ý).",
    "Sách thuộc dịch vụ thuê hoặc trao đổi sách cũ đã xác nhận tình trạng khi bàn giao.",
    "Không cung cấp được mã đơn hàng hoặc bằng chứng kiểm tra hàng hợp lệ.",
  ]),
  channels: Object.freeze([
    "Kênh Chăm sóc khách hàng (CSKH) kèm mã đơn hàng và hình ảnh/video đối chiếu.",
    "Email/đầu mối hỗ trợ được đơn vị vận hành công bố chính thức khi triển khai kinh doanh.",
  ]),
  shippingResponsibility: Object.freeze({
    booknestFault: "BookNest chịu 100% chi phí vận chuyển hai chiều (thu hồi hàng lỗi và gửi hàng đổi mới).",
    customerChangeOfMind: "Khách hàng chịu chi phí vận chuyển hai chiều khi đổi/trả do nhu cầu cá nhân.",
  }),
  workflowSteps: Object.freeze([
    "1. Tiếp nhận yêu cầu qua CSKH kèm mã đơn hàng, lý do và hình ảnh/video bằng chứng.",
    "2. CSKH xác minh đơn hàng, thời hạn 7 ngày, tình trạng sách và phân loại trách nhiệm vận chuyển (phản hồi ≤ 2 ngày làm việc).",
    "3. Gửi/thu hồi hàng hoàn về kho BookNest theo hướng dẫn đóng gói.",
    "4. Kho kiểm tra đối chiếu tình trạng sách thực tế khi nhận lại.",
    "5. Gửi sách đổi mới trong 2–3 ngày làm việc hoặc chuyển quy trình hoàn tiền (3–5 ngày làm việc) và cập nhật lịch sử hỗ trợ/khiếu nại.",
  ]),
  consumerProtectionSync: Object.freeze({
    refundPolicyUrl: "/refund.html",
    termsUrl: "/terms.html",
    privacyUrl: "/privacy.html",
    complaintEscalation: "Mọi khiếu nại về đổi trả được ghi nhận trên hệ thống CSKH và chuyển cấp Quản trị viên xử lý nếu chưa đạt thỏa thuận.",
  }),
});

/**
 * Evaluates whether a return/exchange request meets policy rules.
 */
function evaluateReturnEligibility({
  reason,
  daysSinceDelivery,
  hasEvidence = false,
  itemIntact = false,
  orderDelivered = true,
} = {}) {
  if (!RETURN_REASONS.includes(reason)) {
    return {
      eligible: false,
      shippingPaidBy: null,
      resolutionOptions: [],
      rejectionReason: "Lý do đổi trả không thuộc danh mục áp dụng.",
    };
  }
  if (!orderDelivered) {
    return {
      eligible: false,
      shippingPaidBy: null,
      resolutionOptions: [],
      rejectionReason: "Đơn hàng chưa giao thành công; vui lòng sử dụng quy trình hủy đơn.",
    };
  }
  if (!hasEvidence) {
    return {
      eligible: false,
      shippingPaidBy: null,
      resolutionOptions: [],
      rejectionReason: "Thiếu mã đơn hàng hoặc hình ảnh/video bằng chứng kiểm tra hàng.",
    };
  }
  const days = Number(daysSinceDelivery);
  if (!Number.isFinite(days) || days < 0 || days > RETURN_POLICY.returnWindowDays) {
    return {
      eligible: false,
      shippingPaidBy: null,
      resolutionOptions: [],
      rejectionReason: "Đã quá thời hạn đổi trả 7 ngày kể từ ngày nhận hàng.",
    };
  }
  if (reason === "change_of_mind") {
    if (!itemIntact) {
      return {
        eligible: false,
        shippingPaidBy: null,
        resolutionOptions: [],
        rejectionReason: "Sách đổi/trả do nhu cầu cá nhân phải còn nguyên trạng và đủ phụ kiện.",
      };
    }
    return {
      eligible: true,
      shippingPaidBy: "customer",
      resolutionOptions: ["exchange", "refund_item_only"],
      rejectionReason: null,
    };
  }
  return {
    eligible: true,
    shippingPaidBy: "booknest",
    resolutionOptions:
      reason === "wrong_or_missing_item"
        ? ["exchange_or_reship", "refund_100"]
        : ["exchange", "refund_100"],
    rejectionReason: null,
  };
}

module.exports = {
  RETURN_POLICY,
  RETURN_REASONS,
  evaluateReturnEligibility,
};
