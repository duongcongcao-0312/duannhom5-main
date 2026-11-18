const { createHash, timingSafeEqual } = require("node:crypto");

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
    accessCodeHash: order.accessCodeHash || null,
    items: order.items,
  };
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function hashOrderAccessCode(accessCode) {
  if (typeof accessCode !== "string" || !/^[a-f0-9]{64}$/i.test(accessCode)) {
    throw new TypeError("A 256-bit hexadecimal order access code is required.");
  }
  return createHash("sha256").update(accessCode.toLowerCase(), "utf8").digest("hex");
}

function verifyOrderAccessCode(accessCode, accessCodeHash) {
  if (
    typeof accessCodeHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(accessCodeHash) ||
    typeof accessCode !== "string" ||
    !/^[a-f0-9]{64}$/i.test(accessCode)
  ) return false;
  const expected = Buffer.from(accessCodeHash, "hex");
  const supplied = createHash("sha256").update(accessCode.toLowerCase(), "utf8").digest();
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

module.exports = { hashOrderAccessCode, hashOrderRequest, verifyOrderAccessCode };
