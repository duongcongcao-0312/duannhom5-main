function createOrderRoutes(dependencies) {
  const { RequestError, ROLES, allowedDiscountRates, allowedOrderStatuses, allowedPaymentStatuses, createAndPersistOrder, createOrder, createUpdatedOrderItems, db, defaultBookStock, enqueueOrderWrite, getAuthUser, getClientAddress, getBookCatalog, listQuerySchema, ordersPath, orderRequestLimit, orderRequestWindowMs, paginateList, payloadSchemas, publicOrder, randomUUID, rateLimitRequest, readJson, requireJsonObject, roundMoney, sanitizePlainText, sendJson, sendPaginatedJson, validateQuery, verifyOrderAccessCode, waitForCatalogReady } = dependencies;
  return async function handleRoute(request, response, requestUrl) {
// --- API: Orders ---
if (
  requestUrl.pathname === "/api/orders/quote" &&
  request.method === "POST"
) {
  if (
    request.headers["content-type"]?.split(";")[0] !== "application/json"
  ) {
    throw new RequestError(415, "Báo giá cần được gửi ở định dạng JSON.");
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu báo giá không hợp lệ.",
    payloadSchemas.orderQuote,
  );
  await waitForCatalogReady();
  const requester = await getAuthUser(request);
  const couponCode = typeof payload.couponCode === "string"
    ? sanitizePlainText(payload.couponCode, 32).toUpperCase()
    : "";
  const coupon = couponCode
    ? (await db.getCoupons()).find((entry) => entry.code === couponCode) || null
    : null;
  const quote = createOrder({
    customerName: "Báo giá",
    address: "Xem trước đơn hàng",
    phone: "00000000",
    paymentMethod: "cod",
    couponCode: payload.couponCode,
    discountRate: payload.discountRate,
    items: payload.items,
  }, requester?.userId || null, requester, coupon);
  sendJson(response, 200, {
    discountRate: quote.discountRate,
    couponCode: quote.couponCode,
    couponRate: quote.couponRate,
    subtotal: quote.subtotal,
    discount: quote.discount,
    total: quote.total,
    items: quote.items.map(({ title, quantity, unitPrice, lineTotal }) => ({
      title,
      quantity,
      unitPrice,
      lineTotal,
    })),
  });
  return true;
}

if (requestUrl.pathname === "/api/orders" && request.method === "GET") {
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["createdAt", "status", "total"] } },
    "Bộ lọc đơn hàng không hợp lệ.",
  );
  const requester = await getAuthUser(request);
  if (!requester) {
    throw new RequestError(401, "Vui lòng đăng nhập để tra cứu đơn hàng.");
  }
  const orders = await db.getAllOrders(ordersPath);
  sendPaginatedJson(
    response,
    paginateList(
      orders.filter((order) => order.userId === requester.userId).map(publicOrder),
      filters,
      "createdAt",
    ),
  );
  return true;
}

if (requestUrl.pathname === "/api/orders" && request.method === "POST") {
  if (
    request.headers["content-type"]?.split(";")[0] !== "application/json"
  ) {
    throw new RequestError(415, "Đơn hàng cần được gửi ở định dạng JSON.");
  }

  await rateLimitRequest(
    response,
    "order-create",
    getClientAddress(request),
    orderRequestLimit,
    orderRequestWindowMs,
    "Bạn đã tạo quá nhiều đơn hàng. Vui lòng thử lại sau.",
  );
  const requester = await getAuthUser(request);
  const suppliedIdempotencyKey = String(
    request.headers["idempotency-key"] || "",
  ).trim();
  if (
    suppliedIdempotencyKey &&
    !/^[\w\-:.]{8,128}$/.test(suppliedIdempotencyKey)
  ) {
    throw new RequestError(
      400,
      "Đơn hàng cần có Idempotency-Key hợp lệ để tránh tạo trùng.",
    );
  }
  const idempotencyKey = suppliedIdempotencyKey || randomUUID();
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu đơn hàng không hợp lệ.",
    payloadSchemas.order,
  );
  if (
    (requester && payload.accessCode !== undefined) ||
    (!requester && !/^[a-f0-9]{64}$/i.test(payload.accessCode || ""))
  ) {
    throw new RequestError(
      400,
      requester
        ? "Tài khoản đã đăng nhập không thể gửi mã truy cập đơn khách."
        : "Đơn hàng khách cần mã truy cập gồm 64 ký tự hex.",
    );
  }
  const { order, replayed } = await createAndPersistOrder(
    payload,
    requester?.userId || null,
    requester,
    idempotencyKey,
  );
  sendJson(response, replayed ? 200 : 201, publicOrder(order));
  return true;
}

const orderStatusMatch = requestUrl.pathname.match(
  /^\/api\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/status$/i,
);
if (orderStatusMatch && request.method === "GET") {
  await rateLimitRequest(
    response,
    "order-lookup",
    getClientAddress(request),
    orderRequestLimit,
    orderRequestWindowMs,
    "Bạn đã tra cứu quá nhiều đơn hàng. Vui lòng thử lại sau.",
  );
  const order = await db.findOrderById(orderStatusMatch[1], ordersPath);
  if (!order) {
    sendJson(response, 404, { error: "Không tìm thấy đơn hàng." });
    return true;
  }
  const requester = await getAuthUser(request);
  if (order.userId) {
    if (!requester) {
      throw new RequestError(
        401,
        "Vui lòng đăng nhập để tra cứu trạng thái đơn hàng này.",
      );
    }
    if (requester.role !== ROLES.ADMIN && order.userId !== requester.userId) {
      throw new RequestError(
        403,
        "Bạn không có quyền xem trạng thái đơn hàng của người dùng khác.",
      );
    }
  }
  if (
    !order.userId &&
    requester?.role !== ROLES.ADMIN &&
    !verifyOrderAccessCode(request.headers["x-order-access-code"], order.accessCodeHash)
  ) {
    throw new RequestError(404, "Không tìm thấy đơn hàng.");
  }
  sendJson(response, 200, {
    paymentStatus: order.paymentStatus,
    orderStatus: order.status,
  });
  return true;
}

const orderMatch = requestUrl.pathname.match(
  /^\/api\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (orderMatch && request.method === "GET") {
  await rateLimitRequest(
    response,
    "order-lookup",
    getClientAddress(request),
    orderRequestLimit,
    orderRequestWindowMs,
    "Bạn đã tra cứu quá nhiều đơn hàng. Vui lòng thử lại sau.",
  );
  const order = await db.findOrderById(orderMatch[1], ordersPath);
  if (!order) {
    sendJson(response, 404, { error: "Không tìm thấy đơn hàng." });
    return true;
  }
  const requester = await getAuthUser(request);
  if (requester && requester.role !== ROLES.ADMIN) {
    if (order.userId && order.userId !== requester.userId) {
      throw new RequestError(
        403,
        "Bạn không có quyền xem đơn hàng của người dùng khác.",
      );
    }
    if (order.userId && order.userId === requester.userId) {
      sendJson(response, 200, publicOrder(order));
      return true;
    }
  }
  if (!requester && order.userId) {
    throw new RequestError(
      401,
      "Vui lòng đăng nhập để xem thông tin đơn hàng này.",
    );
  }
  if (
    !order.userId &&
    requester?.role !== ROLES.ADMIN &&
    !verifyOrderAccessCode(request.headers["x-order-access-code"], order.accessCodeHash)
  ) {
    throw new RequestError(404, "Không tìm thấy đơn hàng.");
  }
  sendJson(response, 200, publicOrder(order));
  return true;
}

if (orderMatch && (request.method === "PATCH" || request.method === "PUT")) {
  const requester = await getAuthUser(request);
  if (!requester) {
    throw new RequestError(401, "Chưa đăng nhập.");
  }
  const order = await db.findOrderById(orderMatch[1], ordersPath);
  if (!order) {
    throw new RequestError(404, "Không tìm thấy đơn hàng.");
  }
  if (requester.role !== ROLES.ADMIN && (!order.userId || order.userId !== requester.userId)) {
    throw new RequestError(
      403,
      "Bạn không có quyền cập nhật đơn hàng của người dùng khác.",
    );
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật đơn hàng không hợp lệ.",
    payloadSchemas.orderUpdate,
  );
  const safePayload = { ...payload };
  let orderUpdateOptions = {};
  orderUpdateOptions.actorRole = requester.role;
  orderUpdateOptions.actorId = requester.userId;
  if (
    requester.role === ROLES.USER &&
    (payload.paymentStatus !== undefined || payload.items !== undefined)
  ) {
    throw new RequestError(
      403,
      "Người mua chỉ được phép hủy đơn hàng ở trạng thái phù hợp.",
    );
  }
  if (payload.items !== undefined) {
    if (order.status === "cancelled" || payload.status === "cancelled") {
      throw new RequestError(409, "Không thể cập nhật sản phẩm của đơn hàng đã hủy.");
    }
    await waitForCatalogReady();
    const items = createUpdatedOrderItems(payload.items);
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    if (!Number.isSafeInteger(subtotal)) {
      throw new RequestError(400, "Tổng giá trị đơn hàng không hợp lệ.");
    }
    if (!allowedDiscountRates.has(order.discountRate)) {
      throw new RequestError(400, "Không thể tính lại ưu đãi của đơn hàng.");
    }
    const couponRate = Number.isFinite(order.couponRate)
      ? order.couponRate
      : order.couponCode
        ? (await db.getCoupons()).find((coupon) => coupon.code === order.couponCode)?.rate
        : 0;
    if (order.couponCode && couponRate === undefined) {
      throw new RequestError(400, "Không thể tính lại ưu đãi của đơn hàng.");
    }
    const discount = roundMoney(
      subtotal * Math.min(order.discountRate + couponRate, 0.3),
    );
    const total = subtotal - discount;
    if (!Number.isSafeInteger(discount) || !Number.isSafeInteger(total)) {
      throw new RequestError(400, "Tổng giá trị đơn hàng không hợp lệ.");
    }
    safePayload.items = items;

    const inventoryTitles = new Set([
      ...(order.items || []).map((item) => item.title),
      ...items.map((item) => item.title),
    ]);
    const inventory = [...inventoryTitles].map((title) => {
      const book = getBookCatalog().get(title);
      return {
        title,
        stock:
          Number.isInteger(book && book.stock) && book.stock >= 0
            ? book.stock
            : defaultBookStock,
      };
    });
    const validateOrder = (existingOrders) => {
      const reservedByOthers = new Map();
      for (const existingOrder of existingOrders) {
        if (
          existingOrder.orderId === orderMatch[1] ||
          existingOrder.status === "cancelled"
        ) {
          continue;
        }
        for (const item of existingOrder.items || []) {
          reservedByOthers.set(
            item.title,
            (reservedByOthers.get(item.title) || 0) + Number(item.quantity || 0),
          );
        }
      }
      for (const item of items) {
        const book = getBookCatalog().get(item.title);
        const stock =
          Number.isInteger(book && book.stock) && book.stock >= 0
            ? book.stock
            : defaultBookStock;
        if ((reservedByOthers.get(item.title) || 0) + item.quantity > stock) {
          throw new RequestError(400, "Số lượng sách vượt quá tồn kho.");
        }
      }
    };
    orderUpdateOptions = {
      actorRole: requester.role,
      actorId: requester.userId,
      inventory,
      totals: { subtotal, discount, total },
      validateOrder,
    };
  }
  if (requester.role !== ROLES.ADMIN && safePayload.paymentStatus !== undefined) {
    throw new RequestError(
      403,
      "Chỉ quản trị viên hoặc hệ thống thanh toán mới được xác nhận thanh toán.",
    );
  }
  if (safePayload.status !== undefined) {
    safePayload.status = sanitizePlainText(
      typeof safePayload.status === "string" ? safePayload.status : String(safePayload.status || ""),
      32,
    );
    if (!allowedOrderStatuses.has(safePayload.status)) {
      throw new RequestError(400, "Trạng thái đơn hàng không hợp lệ.");
    }
  }
  if (safePayload.paymentStatus !== undefined) {
    safePayload.paymentStatus = sanitizePlainText(
      typeof safePayload.paymentStatus === "string" ? safePayload.paymentStatus : String(safePayload.paymentStatus || ""),
      32,
    );
    if (!allowedPaymentStatuses.has(safePayload.paymentStatus)) {
      throw new RequestError(400, "Trạng thái thanh toán không hợp lệ.");
    }
  }
  const updated = await enqueueOrderWrite(ordersPath, () =>
    db.updateOrderStatus(
      orderMatch[1],
      safePayload,
      ordersPath,
      orderUpdateOptions,
    ),
  );
  if (!updated) {
    throw new RequestError(404, "Không tìm thấy đơn hàng.");
  }
  sendJson(response, 200, updated);
  return true;
}

    return false;
  };
}

module.exports = { createOrderRoutes };
