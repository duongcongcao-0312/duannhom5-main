const { createHash } = require("node:crypto");

function hashOrderRequest(order) {
  const request = {
    userId: order.userId || null,
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    paymentMethod: order.paymentMethod,
    discountRate: order.discountRate,
    couponCode: order.couponCode,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    items: order.items,
  };
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

module.exports = { hashOrderRequest };
