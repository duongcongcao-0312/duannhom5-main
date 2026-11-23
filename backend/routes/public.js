const fs = require("node:fs/promises");
const { getCouponUnavailableReason } = require("../coupons");
const { PRIVACY_POLICY } = require("../privacy-policy");
const { REFUND_POLICY } = require("../refund-policy");
const { RETURN_POLICY } = require("../return-policy");
const { SHIPPING_POLICY } = require("../shipping-policy");
const { TERMS_POLICY } = require("../terms-policy");
const { CONSUMER_TAX_POLICY } = require("../consumer-tax-policy");
const { ECOMMERCE_COMPLIANCE } = require("../ecommerce-compliance");
const { CONTENT_RIGHTS_POLICY } = require("../content-rights-policy");
const { DATA_RETENTION_POLICY } = require("../data-retention-policy");
const { API_VERSION_POLICY } = require("../api-versioning");
const { resolveSafeStoredUploadPath } = require("../request-limits");

function createPublicRoutes({
  db,
  getCatalogBookList,
  logRequestError,
  paginateBookList,
  sendJson,
  sendPaginatedJson,
  uploadsDir,
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

    if (requestUrl.pathname === "/api/version" && request.method === "GET") {
      sendJson(response, 200, API_VERSION_POLICY);
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

    if (requestUrl.pathname === "/api/policies/terms" && request.method === "GET") {
      sendJson(response, 200, { policy: TERMS_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/privacy" && request.method === "GET") {
      sendJson(response, 200, { policy: PRIVACY_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/consumer-tax" && request.method === "GET") {
      sendJson(response, 200, { policy: CONSUMER_TAX_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/ecommerce-compliance" && request.method === "GET") {
      sendJson(response, 200, { policy: ECOMMERCE_COMPLIANCE });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/content-rights" && request.method === "GET") {
      sendJson(response, 200, { policy: CONTENT_RIGHTS_POLICY });
      return true;
    }

    if (requestUrl.pathname === "/api/policies/retention" && request.method === "GET") {
      sendJson(response, 200, { policy: DATA_RETENTION_POLICY });
      return true;
    }

    if (requestUrl.pathname.startsWith("/api/uploads/book-covers/") && request.method === "GET") {
      const filename = requestUrl.pathname.slice("/api/uploads/book-covers/".length);
      const resolved = uploadsDir ? resolveSafeStoredUploadPath(uploadsDir, filename) : null;
      if (!resolved) {
        sendJson(response, 404, { error: "Không tìm thấy tệp ảnh." });
        return true;
      }
      let contents;
      try {
        contents = await fs.readFile(resolved.filePath);
      } catch (error) {
        if (error && error.code === "ENOENT") {
          sendJson(response, 404, { error: "Không tìm thấy tệp ảnh." });
          return true;
        }
        throw error;
      }
      response.writeHead(200, {
        "Content-Type": resolved.mimeType,
        "Content-Length": contents.length,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=86400",
      });
      response.end(contents);
      return true;
    }
    return false;
  };
}

module.exports = { createPublicRoutes };