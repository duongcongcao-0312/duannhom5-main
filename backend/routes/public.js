const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
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
const { CONSENT_POLICY } = require("../consent-policy");
const { API_VERSION_POLICY } = require("../api-versioning");
const { resolveSafeStoredUploadPath } = require("../request-limits");

function createPublicRoutes({
  RequestError,
  db,
  getAuthUser,
  getDatabaseMonitoringStatus,
  getCatalogBookList,
  logRequestError,
  paginateBookList,
  sendJson,
  sendPaginatedJson,
  uploadsDir,
  validateBookQuery,
  readJson,
  requireJsonObject,
  payloadSchemas,
  sanitizePlainText,
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
        const monitoringStatus = typeof getDatabaseMonitoringStatus === "function"
          ? await getDatabaseMonitoringStatus(response.getHeader("X-Request-Id"))
          : null;
        const ready = monitoringStatus?.status !== "unavailable";
        sendJson(response, ready ? 200 : 503, {
          status: ready ? "ready" : "not_ready",
          service: "booknest",
          ...(monitoringStatus?.connections ? { connections: monitoringStatus.connections } : {}),
        }, request.method);
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
      if (filters.minPrice !== undefined && filters.maxPrice !== undefined &&
          filters.minPrice > filters.maxPrice) {
        throw new RequestError(400, "Khoảng giá không hợp lệ.");
      }
      let records = await getCatalogBookList();
      const normalizeSearch = (value) => String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
        .toLocaleLowerCase("vi")
        .trim();
      const search = normalizeSearch(filters.search);
      if (search) {
        const normalizedIsbn = search.replace(/[\s-]/g, "");
        records = records.filter((book) => (
          normalizeSearch(`${book.title} ${book.author}`).includes(search) ||
          (normalizedIsbn && String(book.isbn || "").replace(/[\s-]/g, "").toLowerCase().includes(normalizedIsbn))
        ));
      }
      if (filters.category) {
        records = records.filter((book) => book.category === filters.category);
      }
      if (filters.minPrice !== undefined) {
        records = records.filter((book) => Number(book.price) >= filters.minPrice);
      }
      if (filters.maxPrice !== undefined) {
        records = records.filter((book) => Number(book.price) <= filters.maxPrice);
      }
      const orderCounts = new Map();
      if (filters.sort === "popularity") {
        const orders = await db.getAllOrders();
        for (const order of orders) {
          if (order.status === "cancelled") continue;
          for (const item of order.items || []) {
            orderCounts.set(item.title, (orderCounts.get(item.title) || 0) + Number(item.quantity || 0));
          }
        }
      }
      const catalog = records.map((book) => ({
        ...book,
        availability: Number(book.stock) > 0 ? "in_stock" : "out_of_stock",
        ...(filters.sort === "popularity"
          ? { popularity: orderCounts.get(book.title) || 0 }
          : {}),
      }));
      sendPaginatedJson(response, paginateBookList(catalog, filters));
      return true;
    }

    const reviewsMatch = requestUrl.pathname.match(
      /^\/api\/books\/([A-Za-z0-9_-]{1,128})\/reviews$/,
    );
    if (reviewsMatch && request.method === "GET") {
      const book = (await getCatalogBookList()).find((entry) => entry.id === reviewsMatch[1]);
      if (!book) throw new RequestError(404, "Không tìm thấy sách.");
      const reviews = (await db.getCatalogRecords("reviews"))
        .filter((entry) => entry.bookId === book.id && entry.status === "visible")
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      const averageRating = reviews.length
        ? reviews.reduce((total, entry) => total + entry.rating, 0) / reviews.length
        : 0;
      sendJson(response, 200, {
        averageRating: Math.round(averageRating * 10) / 10,
        reviewCount: reviews.length,
        reviews: reviews.map(({ id, rating, content, userName, createdAt }) => ({
          id, rating, content, userName, createdAt,
        })),
      });
      return true;
    }

    if (reviewsMatch && request.method === "POST") {
      const user = await getAuthUser(request);
      if (!user) throw new RequestError(401, "Vui lòng đăng nhập để đánh giá sách.");
      const payload = requireJsonObject(
        await readJson(request),
        "Nội dung đánh giá không hợp lệ.",
        payloadSchemas.review,
      );
      if (!Number.isInteger(payload.rating)) {
        throw new RequestError(400, "Điểm đánh giá phải là số nguyên từ 1 đến 5.");
      }
      const book = (await getCatalogBookList()).find((entry) => entry.id === reviewsMatch[1]);
      if (!book) throw new RequestError(404, "Không tìm thấy sách.");
      const content = sanitizePlainText(payload.content, 1000);
      if (!content) throw new RequestError(400, "Nhận xét không được để trống.");
      const orders = await db.getAllOrders();
      const eligible = orders.some((order) =>
        order.userId === user.userId &&
        order.status === "completed" &&
        (order.items || []).some((item) => item.title === book.title)
      );
      if (!eligible) {
        throw new RequestError(403, "Chỉ tài khoản đã hoàn tất mua sách này mới được đánh giá.");
      }
      const review = await db.updateCatalogRecords("reviews", (reviews) => {
        if (reviews.some((entry) => entry.bookId === book.id && entry.userId === user.userId)) {
          throw new RequestError(409, "Bạn đã gửi đánh giá cho sách này.");
        }
        const created = {
          id: randomUUID(),
          bookId: book.id,
          bookTitle: book.title,
          userId: user.userId,
          userName: sanitizePlainText(user.name || "Khách hàng", 120),
          rating: payload.rating,
          content,
          reporterIds: [],
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        reviews.push(created);
        return created;
      });
      sendJson(response, 201, {
        id: review.id,
        status: review.status,
        message: "Đánh giá đã được gửi để kiểm duyệt.",
      });
      return true;
    }

    const reportMatch = requestUrl.pathname.match(
      /^\/api\/reviews\/([0-9a-f-]{36})\/report$/i,
    );
    if (reportMatch && request.method === "POST") {
      const user = await getAuthUser(request);
      if (!user) throw new RequestError(401, "Vui lòng đăng nhập để báo cáo đánh giá.");
      const updated = await db.updateCatalogRecords("reviews", (reviews) => {
        const review = reviews.find((entry) =>
          entry.id === reportMatch[1] && entry.status === "visible"
        );
        if (!review) return null;
        const reporters = Array.isArray(review.reporterIds) ? review.reporterIds : [];
        if (!reporters.includes(user.userId)) reporters.push(user.userId);
        review.reporterIds = reporters;
        review.reportCount = reporters.length;
        return review;
      });
      if (!updated) throw new RequestError(404, "Không tìm thấy đánh giá.");
      sendJson(response, 200, { success: true });
      return true;
    }

    if (requestUrl.pathname === "/api/favorites" &&
        ["GET", "POST", "DELETE"].includes(request.method)) {
      const user = await getAuthUser(request);
      if (!user) throw new RequestError(401, "Vui lòng đăng nhập để quản lý sách yêu thích.");
      if (request.method === "GET") {
        const availableIds = new Set((await getCatalogBookList())
          .filter((book) =>
            book.isActive !== false &&
            !book.discontinued &&
            book.status !== "inactive"
          )
          .map((book) => book.id));
        const bookIds = (await db.getCatalogRecords("favorites"))
          .filter((entry) => entry.userId === user.userId && availableIds.has(entry.bookId))
          .map((entry) => entry.bookId);
        sendJson(response, 200, { bookIds });
        return true;
      }
      const payload = requireJsonObject(
        await readJson(request),
        "Sách yêu thích không hợp lệ.",
        payloadSchemas.favorite,
      );
      const book = request.method === "POST"
        ? (await getCatalogBookList()).find((entry) =>
          entry.id === payload.bookId &&
          entry.isActive !== false &&
          !entry.discontinued &&
          entry.status !== "inactive"
        )
        : null;
      if (request.method === "POST" && !book) {
        throw new RequestError(404, "Không tìm thấy sách đang được bán.");
      }
      const favorites = await db.updateCatalogRecords("favorites", (records) => {
        const index = records.findIndex((entry) =>
          entry.userId === user.userId && entry.bookId === payload.bookId
        );
        if (request.method === "POST" && index < 0) {
          records.push({
            userId: user.userId,
            bookId: payload.bookId,
            createdAt: new Date().toISOString(),
          });
        }
        if (request.method === "DELETE" && index >= 0) records.splice(index, 1);
        return records.filter((entry) => entry.userId === user.userId).map((entry) => entry.bookId);
      });
      sendJson(response, 200, { bookIds: favorites });
      return true;
    }

    const relatedMatch = requestUrl.pathname.match(
      /^\/api\/books\/([A-Za-z0-9_-]{1,128})\/related$/,
    );
    if (relatedMatch && request.method === "GET") {
      const bookList = await getCatalogBookList();
      const book = bookList.find((entry) => entry.id === relatedMatch[1]);
      if (!book) throw new RequestError(404, "Không tìm thấy sách.");
      const related = bookList
        .filter((entry) =>
          entry.id !== book.id &&
          entry.stock > 0 &&
          entry.isActive !== false &&
          !entry.discontinued &&
          entry.status !== "inactive" &&
          ((book.category && entry.category === book.category) ||
            (book.author && entry.author === book.author))
        )
        .sort((left, right) => {
          const leftScore = Number(left.category === book.category) + Number(left.author === book.author);
          const rightScore = Number(right.category === book.category) + Number(right.author === book.author);
          return rightScore - leftScore ||
            String(left.title).localeCompare(String(right.title), "vi");
        })
        .slice(0, 4)
        .map((entry) => ({ ...entry, availability: "in_stock" }));
      sendJson(response, 200, related);
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

    if (requestUrl.pathname === "/api/policies/consent" && request.method === "GET") {
      sendJson(response, 200, { policy: CONSENT_POLICY });
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
