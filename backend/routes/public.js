const { getCouponUnavailableReason } = require("../coupons");
const { REFUND_POLICY } = require("../refund-policy");
const { RETURN_POLICY } = require("../return-policy");
const { SHIPPING_POLICY } = require("../shipping-policy");

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
  getBookPublishers,
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

    if (requestUrl.pathname === "/api/publishers" && request.method === "GET") {
      const publishers = (await getBookPublishers()).filter((publisher) => publisher.status !== "inactive");
      sendJson(response, 200, publishers);
      return true;
    }

    if (requestUrl.pathname === "/api/policies/refund" && request.method === "GET") {
      sendJson(response, 200, { policy: REFUND_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/return" && request.method === "GET") {
      sendJson(response, 200, { policy: RETURN_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/shipping" && request.method === "GET") {
      sendJson(response, 200, { policy: SHIPPING_POLICY });
      return true;
    }
    return false;
  };
}

module.exports = { createPublicRoutes };