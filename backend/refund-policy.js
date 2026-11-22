"use strict";

/**
 * Public refund & return policy and backend refund transition rules (BN-193 / issue #269).
 *
 * Synchronized with order status lifecycle, payment reconciliation (SePay / COD),
 * 7-day return window, and customer support workflow.
 */

const REFUND_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/refund.html",
  returnWindowDays: 7,
  reviewBusinessDays: 2,
  refundTimelineBusinessDays: {
    min: 3,
    max: 5,
  },
  eligibleCases: Object.freeze([
    {
      code: "pre_shipment_cancellation",
      title: "Hủy đơn đã thanh toán trước khi giao hàng",
      refundRate: "100%",
      condition: "Đơn chuyển khoản đã xác nhận thanh toán (paid) và được hủy ở trạng thái chờ tiếp nhận/xử lý trước khi bàn giao vận chuyển.",
    },
    {
      code: "defective_or_wrong_item",
      title: "Sách lỗi in ấn, hư hỏng do vận chuyển hoặc giao sai/thiếu sách",
      refundRate: "100%",
      condition: "Thông báo cho CSKH trong vòng 7 ngày kể từ ngày nhận hàng kèm mã đơn và hình ảnh/video kiểm tra hàng.",
    },
    {
      code: "out_of_stock_after_payment",
      title: "Hết hàng sau khi đã thanh toán",
      refundRate: "100%",
      condition: "BookNest không thể cung cấp đủ sách theo đơn đã thanh toán và khách chọn hoàn tiền thay vì đổi sách tương đương.",
    },
    {
      code: "change_of_mind_return",
      title: "Khách đổi ý trả hàng trong thời hạn đổi trả",
      refundRate: "100% giá trị sách (không gồm phí vận chuyển hai chiều nếu có)",
      condition: "Gửi yêu cầu trong vòng 7 ngày kể từ khi nhận hàng; sách còn nguyên trạng, chưa sử dụng, không rách/viết vẽ và đủ phụ kiện đi kèm.",
    },
  ]),
  nonRefundableCases: Object.freeze([
    "Đơn hàng chưa phát sinh thanh toán thành công (pending, failed, cancelled chưa thu tiền, cod_pending chưa thu tiền).",
    "Yêu cầu gửi quá 7 ngày kể từ ngày nhận hàng (trừ trường hợp lỗi phát sinh từ BookNest).",
    "Sách đã qua sử dụng, rách, ướt, viết vẽ hoặc thiếu phụ kiện tặng kèm so với lúc giao.",
  ]),
  methods: Object.freeze([
    {
      paymentMethod: "transfer",
      method: "Hoàn về đúng tài khoản ngân hàng nguồn đã chuyển khoản",
      timeline: "3–5 ngày làm việc sau khi phê duyệt và đối soát mã thanh toán (BN...).",
    },
    {
      paymentMethod: "cod",
      method: "Chuyển khoản ngân hàng vào tài khoản chính chủ do khách xác nhận",
      timeline: "3–5 ngày làm việc sau khi kho xác nhận nhận lại hàng hoàn hợp lệ.",
    },
  ]),
  workflowSteps: Object.freeze([
    "1. Tiếp nhận yêu cầu qua CSKH kèm mã đơn hàng, lý do và chứng từ/hình ảnh (nếu có).",
    "2. Kiểm tra điều kiện đổi trả (7 ngày) và đối soát giao dịch thanh toán (mã BN... trên SePay hoặc biên nhận thu hộ COD).",
    "3. Quản trị viên có quyền phê duyệt (write:orders) xác nhận mức hoàn và phương thức hoàn.",
    "4. Kế toán/vận hành thực hiện chuyển hoàn theo phương thức tương ứng.",
    "5. Cập nhật trạng thái thanh toán đơn hàng sang refunded và ghi nhật ký kiểm toán.",
  ]),
});

/**
 * Validates refund payment-status transitions on an order.
 * Returns null if valid, or `{ status, message }` when invalid.
 */
function validateRefundTransition(order, nextOrderStatus, nextPaymentStatus) {
  if (!order) return null;
  if (
    order.paymentStatus === "refunded" &&
    nextPaymentStatus !== undefined &&
    nextPaymentStatus !== "refunded"
  ) {
    return {
      status: 409,
      message: "Đơn hàng đã hoàn tiền không thể chuyển sang trạng thái thanh toán khác.",
    };
  }
  if (nextPaymentStatus === "refunded" && order.paymentStatus !== "refunded") {
    const isPaidTransferOrOrder = order.paymentStatus === "paid";
    const isCollectedCod = order.paymentMethod === "cod" && order.status === "completed";
    if (!isPaidTransferOrOrder && !isCollectedCod) {
      return {
        status: 400,
        message: "Chỉ có thể hoàn tiền cho đơn hàng đã thanh toán thành công.",
      };
    }
  }
  if (
    nextOrderStatus === "completed" &&
    order.status !== "completed" &&
    nextPaymentStatus === "refunded"
  ) {
    return {
      status: 400,
      message: "Không thể đánh dấu hoàn tất cho đơn hàng đang chuyển sang trạng thái hoàn tiền.",
    };
  }
  return null;
}

module.exports = {
  REFUND_POLICY,
  validateRefundTransition,
};
