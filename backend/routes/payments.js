const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

function createPaymentRoutes({
  RequestError,
  db,
  monitoringMetrics,
  ordersPath,
  paymentWebhookSecret,
  publicOrder,
  readRawBody,
  sepayConfig,
  sendJson,
}) {
  return async function handlePaymentRoute(request, response, pathname) {
    if (pathname === "/api/payments/config" && request.method === "GET") {
      if (sepayConfig.invalid.some((field) => field !== "SEPAY_API_KEY")) {
        throw new RequestError(503, "Thông tin tài khoản nhận thanh toán chưa được cấu hình.");
      }
      sendJson(response, 200, {
        bankCode: sepayConfig.config.bankCode,
        bankName: sepayConfig.config.bankName,
        accountNumber: sepayConfig.config.accountNumber,
        accountName: sepayConfig.config.accountName,
      });
      return true;
    }

    if (pathname === "/api/payments/webhook" && request.method === "POST") {
      if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
        throw new RequestError(415, "Webhook cần được gửi ở định dạng JSON.");
      }
      if (
        typeof paymentWebhookSecret !== "string" ||
        Buffer.byteLength(paymentWebhookSecret, "utf8") < 32
      ) {
        throw new RequestError(503, "Webhook thanh toán chưa được cấu hình an toàn.");
      }
      if (typeof db.applyPaymentWebhookEvent !== "function") {
        throw new RequestError(503, "Webhook thanh toán yêu cầu kho PostgreSQL dùng chung.");
      }
      const signature = request.headers["x-booknest-signature"] || "";
      const rawBody = await readRawBody(request);
      const expectedSignature = createHmac("sha256", paymentWebhookSecret)
        .update(rawBody)
        .digest();
      const suppliedSignature = typeof signature === "string"
        ? signature.match(/^sha256=([a-f0-9]{64})$/i)?.[1]
        : null;
      if (!suppliedSignature) {
        throw new RequestError(401, "Chữ ký webhook không hợp lệ.");
      }
      const suppliedDigest = Buffer.from(suppliedSignature, "hex");
      if (
        suppliedDigest.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedDigest, expectedSignature)
      ) {
        throw new RequestError(401, "Chữ ký webhook không hợp lệ.");
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new RequestError(400, "Payload webhook không hợp lệ.");
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).some((key) => ![
          "id",
          "orderId",
          "status",
          "amount",
          "currency",
          "occurredAt",
        ].includes(key)) ||
        typeof payload.id !== "string" ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(payload.id) ||
        typeof payload.orderId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.orderId) ||
        !["succeeded", "failed", "pending", "cancelled"].includes(payload.status) ||
        !Number.isSafeInteger(payload.amount) ||
        payload.amount < 0 ||
        payload.currency !== "VND" ||
        typeof payload.occurredAt !== "string" ||
        !Number.isFinite(Date.parse(payload.occurredAt)) ||
        Date.parse(payload.occurredAt) > Date.now() + 5 * 60 * 1000
      ) {
        throw new RequestError(400, "Payload webhook không hợp lệ.");
      }

      const paymentStatus = {
        succeeded: "paid",
        failed: "failed",
        pending: "pending",
        cancelled: "cancelled",
      }[payload.status];
      const result = await db.applyPaymentWebhookEvent({
        eventId: payload.id,
        eventHash: createHmac("sha256", paymentWebhookSecret)
          .update(rawBody)
          .digest("hex"),
        orderId: payload.orderId,
        paymentStatus,
        amount: payload.amount,
        occurredAt: payload.occurredAt,
      });
      if (result.duplicate) monitoringMetrics.recordPaymentWebhookDuplicate();
      if (result.conflict) {
        throw new RequestError(409, "Webhook ID đã được dùng với payload khác.");
      }
      sendJson(response, 200, {
        received: true,
        duplicate: result.duplicate,
        stale: result.stale || false,
        ...(result.order ? { order: publicOrder(result.order) } : {}),
      });
      return true;
    }

    if (pathname === "/api/payments/sepay-webhook" && request.method === "POST") {
      if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
        throw new RequestError(415, "SePay webhook cần được gửi ở định dạng JSON.");
      }
      if (
        sepayConfig.invalid.includes("SEPAY_API_KEY") ||
        sepayConfig.invalid.includes("SEPAY_ACCOUNT_NUMBER")
      ) {
        throw new RequestError(503, "SePay webhook chưa được cấu hình đầy đủ.");
      }
      const authorization = request.headers.authorization || "";
      const expectedAuthorization = Buffer.from(`Apikey ${sepayConfig.config.apiKey}`, "utf8");
      const suppliedAuthorization = Buffer.from(String(authorization), "utf8");
      if (
        expectedAuthorization.length !== suppliedAuthorization.length ||
        !timingSafeEqual(expectedAuthorization, suppliedAuthorization)
      ) {
        throw new RequestError(401, "SePay API Key không hợp lệ.");
      }

      const rawBody = await readRawBody(request);
      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new RequestError(400, "Payload SePay không phải JSON hợp lệ.");
      }
      const eventId = typeof payload?.id === "string" || Number.isSafeInteger(payload?.id)
        ? String(payload.id)
        : "";
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(eventId) ||
        !Number.isSafeInteger(Number(payload.transferAmount)) ||
        Number(payload.transferAmount) <= 0 ||
        typeof payload.transferType !== "string"
      ) {
        throw new RequestError(400, "Payload giao dịch SePay thiếu trường bắt buộc.");
      }

      if (payload.transferType.toLowerCase() !== "in") {
        sendJson(response, 200, { success: true, ignored: true, reason: "not_incoming" });
        return true;
      }
      if (String(payload.accountNumber || "").trim() !== sepayConfig.config.accountNumber) {
        sendJson(response, 200, { success: true, ignored: true, reason: "bank_account_mismatch" });
        return true;
      }

      const paymentCodePattern = /\b(BN[A-F0-9]{12})\b/i;
      const transactionText = [payload.content, payload.description, payload.code]
        .filter((value) => typeof value === "string")
        .join(" ");
      const paymentCode = transactionText.match(paymentCodePattern)?.[1]?.toUpperCase();
      if (!paymentCode) {
        sendJson(response, 200, { success: true, ignored: true, reason: "payment_code_not_found" });
        return true;
      }

      const rawTransactionDate = typeof payload.transactionDate === "string"
        ? payload.transactionDate.trim().replace(" ", "T")
        : "";
      const occurredAt = rawTransactionDate
        ? (/Z$|[+-]\d{2}:?\d{2}$/.test(rawTransactionDate)
          ? rawTransactionDate
          : `${rawTransactionDate}+07:00`)
        : new Date().toISOString();
      if (
        !Number.isFinite(Date.parse(occurredAt)) ||
        Date.parse(occurredAt) > Date.now() + 5 * 60 * 1000
      ) {
        throw new RequestError(400, "Thời gian giao dịch SePay không hợp lệ.");
      }
      if (typeof db.applyPaymentWebhookEvent !== "function") {
        throw new RequestError(503, "SePay webhook yêu cầu kho PostgreSQL dùng chung.");
      }
      if (typeof db.getAllOrders !== "function") {
        throw new RequestError(503, "Kho dữ liệu không hỗ trợ đối chiếu mã thanh toán SePay.");
      }

      const orders = await db.getAllOrders(ordersPath);
      const matchingOrder = orders.find((order) =>
        String(order.paymentCode || "").toUpperCase() === paymentCode);
      if (!matchingOrder) {
        sendJson(response, 200, { success: true, ignored: true, reason: "order_not_found" });
        return true;
      }
      if (
        matchingOrder.paymentMethod !== "transfer" ||
        matchingOrder.total !== Number(payload.transferAmount)
      ) {
        sendJson(response, 200, { success: true, ignored: true, reason: "payment_details_mismatch" });
        return true;
      }

      const result = await db.applyPaymentWebhookEvent({
        eventId: `sepay:${eventId}`,
        eventHash: createHash("sha256").update(rawBody).digest("hex"),
        orderId: matchingOrder.orderId,
        paymentStatus: "paid",
        amount: Number(payload.transferAmount),
        occurredAt: new Date(occurredAt).toISOString(),
      });
      if (result.duplicate) monitoringMetrics.recordPaymentWebhookDuplicate();
      if (result.conflict) {
        throw new RequestError(409, "Mã giao dịch SePay đã được sử dụng với dữ liệu khác.");
      }
      sendJson(response, 200, { success: true, duplicate: Boolean(result.duplicate) });
      return true;
    }

    return false;
  };
}

module.exports = { createPaymentRoutes };