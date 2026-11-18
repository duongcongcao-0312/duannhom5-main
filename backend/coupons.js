const DEFAULT_COUPONS = Object.freeze([
  Object.freeze({
    code: "BOOKNEST10",
    label: "Ưu đãi BookNest",
    rate: 0.1,
    minSubtotal: 0,
    maxUses: null,
    usedCount: 0,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
  Object.freeze({
    code: "WELCOME5",
    label: "Ưu đãi chào mừng",
    rate: 0.05,
    minSubtotal: 0,
    maxUses: null,
    usedCount: 0,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
]);

function getCouponUnavailableReason(coupon, { subtotal, now = Date.now() } = {}) {
  if (
    !coupon ||
    !coupon.enabled ||
    !Number.isFinite(coupon.rate) ||
    coupon.rate <= 0 ||
    coupon.rate > 0.3
  ) {
    return "Mã ưu đãi không hợp lệ hoặc đã hết hạn.";
  }
  if (coupon.startsAt) {
    const startsAtMs = Date.parse(coupon.startsAt);
    if (!Number.isFinite(startsAtMs)) {
      return "Mã ưu đãi không hợp lệ hoặc đã hết hạn.";
    }
    if (startsAtMs > now) {
      return "Mã ưu đãi chưa đến thời gian áp dụng.";
    }
  }
  if (coupon.expiresAt) {
    const expiresAtMs = Date.parse(coupon.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return "Mã ưu đãi không hợp lệ hoặc đã hết hạn.";
    }
  }
  if (
    coupon.maxUses !== null &&
    coupon.maxUses !== undefined &&
    Number(coupon.usedCount || 0) >= coupon.maxUses
  ) {
    return "Mã ưu đãi đã hết lượt sử dụng.";
  }
  if (subtotal !== undefined && subtotal < coupon.minSubtotal) {
    return `Đơn hàng cần đạt tối thiểu ${coupon.minSubtotal} đ để áp dụng mã.`;
  }
  return "";
}

module.exports = {
  DEFAULT_COUPONS,
  getCouponUnavailableReason,
};
