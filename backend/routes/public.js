const { getCouponUnavailableReason } = require("../coupons");

function createPublicRoutes({
  db,
  getCatalogBookList,
  logRequestError,
  paginateBookList,
  sendJson,
  sendPaginatedJson,
  validateBookQuery,
  getBookCategories,
  getBookAuthors,
}) {
  return async function handlePublicRoute(request, response, requestUrl) {
    if (
      requestUrl.pathname === "/health" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(response, 200, { status: "ok", service: "booknest" }, request.method);
      return true;
    }

    if (
      requestUrl.pathname === "/ready" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      try {
        await db.init();
        sendJson(response, 200, { status: "ready", service: "booknest" }, request.method);
      } catch (error) {
        logRequestError(
          request,
          response.getHeader("X-Request-Id"),
          error,
          "Readiness check failed",
        );
        sendJson(response, 503, { status: "not_ready", service: "booknest" }, request.method);
      }
      return true;
    }

    const couponMatch = requestUrl.pathname.match(/^\/api\/coupons\/([A-Za-z0-9_-]+)$/);
    if (couponMatch && request.method === "GET") {
      const code = couponMatch[1].toUpperCase();
      const coupon = (await db.getCoupons()).find((entry) => entry.code === code);
      const reason = getCouponUnavailableReason(coupon);
      if (reason) {
        sendJson(response, 404, { error: reason });
        return true;
      }
      sendJson(response, 200, {
        code: coupon.code,
        label: coupon.label,
        rate: coupon.rate,
        minSubtotal: coupon.minSubtotal,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/books" && request.method === "GET") {
      const filters = validateBookQuery(requestUrl);
      sendPaginatedJson(response, paginateBookList(
        await getCatalogBookList(),
        filters,
      ));
      return true;
    }

    if (requestUrl.pathname === "/api/categories" && request.method === "GET") {
      const categories = (await getBookCategories()).filter((category) => category.status !== "inactive");
      sendJson(response, 200, categories);
      return true;
    }
    if (requestUrl.pathname === "/api/authors" && request.method === "GET") {
      const authors = (await getBookAuthors()).filter((author) => author.status !== "inactive");
      sendJson(response, 200, authors);
      return true;
    }
    return false;
  };
}

module.exports = { createPublicRoutes };