"use strict";

/**
 * Public shipping policy and fee/ETA estimator (BN-191 / issue #267).
 *
 * Synchronized with checkout disclosure, order tracking lifecycle,
 * customer support exception handling, return shipping, and refund policy.
 */

const FREE_SHIPPING_THRESHOLD_VND = 300_000;

const SHIPPING_ZONES = Object.freeze({
  inner_city: Object.freeze({
    code: "inner_city",
    label: "Nội thành TP.HCM & Hà Nội",
    standardFeeVnd: 20_000,
    estimatedBusinessDays: Object.freeze({ min: 1, max: 2 }),
  }),
  nationwide: Object.freeze({
    code: "nationwide",
    label: "Các tỉnh/thành phố khác trên toàn quốc",
    standardFeeVnd: 30_000,
    estimatedBusinessDays: Object.freeze({ min: 2, max: 5 }),
  }),
  remote: Object.freeze({
    code: "remote",
    label: "Tuyến huyện đảo, vùng sâu vùng xa",
    standardFeeVnd: 45_000,
    estimatedBusinessDays: Object.freeze({ min: 4, max: 7 }),
  }),
});

const SHIPPING_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/shipping.html",
  freeShippingThresholdVnd: FREE_SHIPPING_THRESHOLD_VND,
  serviceAreas: Object.freeze(Object.values(SHIPPING_ZONES)),
  methods: Object.freeze([
    {
      code: "standard",
      title: "Giao hàng tiêu chuẩn toàn quốc",
      supportsCod: true,
      supportsTransfer: true,
      note: "Áp dụng trên toàn bộ phạm vi phục vụ; thời gian giao dự kiến 1–7 ngày làm việc tùy khu vực.",
    },
    {
      code: "express_inner_city",
      title: "Giao nhanh nội thành (khi đối tác vận chuyển hỗ trợ)",
      supportsCod: true,
      supportsTransfer: true,
      note: "Chỉ áp dụng nội thành TP.HCM & Hà Nội; phụ phí giao nhanh hiển thị trước khi xác nhận đơn.",
    },
  ]),
  orderTracking: Object.freeze({
    portalFeature: "Tra cứu đơn hàng (#trackOrderDialog)",
    requiredForAccountOrder: "Đăng nhập đúng tài khoản đặt hàng và chọn/nhập mã đơn (UUID).",
    requiredForGuestOrder: "Mã đơn hàng (UUID) và mã truy cập đơn khách được cấp một lần khi đặt hàng.",
    statusFlow: Object.freeze(["received", "processing", "shipping", "completed", "cancelled"]),
  }),
  exceptionHandling: Object.freeze({
    failedDelivery:
      "Đơn vị vận chuyển liên hệ giao lại tối đa 3 lần trong 3 ngày làm việc. Nếu vẫn không giao được, đơn hoàn về kho và CSKH liên hệ khách để sắp xếp giao lại hoặc hủy/hoàn tiền (nếu đã thanh toán).",
    delayedDelivery:
      "Nếu đơn vượt quá thời gian giao ước tính, CSKH tra soát với đơn vị vận chuyển và phản hồi trong vòng 1 ngày làm việc. Khách có thể chọn hủy đơn và nhận hoàn tiền 100% nếu đơn tiếp tục chậm quá mốc cam kết bổ sung.",
    wrongAddress:
      "Hỗ trợ cập nhật địa chỉ miễn phí khi đơn ở trạng thái received hoặc processing (trước khi bàn giao vận chuyển). Khi đơn đã ở trạng thái shipping, việc đổi địa chỉ phụ thuộc đơn vị vận chuyển và có thể phát sinh phụ phí thực tế.",
  }),
  syncPoints: Object.freeze({
    checkout: "Hiển thị tóm tắt thời gian giao dự kiến, ngưỡng miễn phí vận chuyển và liên kết shipping.html trước nút Xác nhận đặt hàng.",
    email: "Email thông báo đơn hàng (khi bật dịch vụ email) đính kèm mã đơn, thời gian giao dự kiến và liên kết tra cứu cùng shipping.html.",
    support: "CSKH theo dõi sự cố giao hàng qua lịch sử tương tác CRM và đồng bộ với chính sách đổi trả (returns.html) và hoàn tiền (refund.html).",
  }),
});

/**
 * Estimates shipping fee and delivery window for a given zone and order subtotal.
 */
function estimateShipping({ zone = "nationwide", subtotal = 0 } = {}) {
  const zoneConfig = SHIPPING_ZONES[zone];
  if (!zoneConfig) {
    throw new RangeError("Khu vực giao hàng không hợp lệ.");
  }
  const amount = Number(subtotal);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Giá trị đơn hàng không hợp lệ.");
  }
  const freeShippingApplied =
    zone !== "remote" && amount >= FREE_SHIPPING_THRESHOLD_VND;
  return {
    zone: zoneConfig.code,
    label: zoneConfig.label,
    fee: freeShippingApplied ? 0 : zoneConfig.standardFeeVnd,
    freeShippingApplied,
    estimatedBusinessDays: { ...zoneConfig.estimatedBusinessDays },
  };
}

module.exports = {
  FREE_SHIPPING_THRESHOLD_VND,
  SHIPPING_POLICY,
  SHIPPING_ZONES,
  estimateShipping,
};
