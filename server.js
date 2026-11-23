const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
if (!process.env.NODE_TEST_CONTEXT) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
}
const {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require("node:crypto");
const books = require("./books-data");
const {
  CustomerError,
  Database,
  SOCIAL_PROVIDERS,
  validateCustomerInteractionData,
  validateCustomerData,
} = require("./backend/db");
const { PostgresDatabase } = require("./backend/postgres-db");
const { normalizeSePayConfig } = require("./backend/sepay-config");
const {
  appendAuditEntry,
  readAuditEntries,
  withAuditRequestContext,
} = require("./backend/audit");
const {
  MonitoringMetrics,
  formatSafeErrorLog,
  normalizeRequestRoute,
  redactLogText,
} = require("./backend/monitoring");
const {
  hashOrderAccessCode,
  hashOrderRequest,
  verifyOrderAccessCode,
} = require("./backend/order-idempotency");
const { getAdminPermission } = require("./backend/router");
const {
  SUPPORTED_API_VERSIONS,
  applyApiVersionHeaders,
  resolveApiVersion,
} = require("./backend/api-versioning");
const { extractSessionToken, validateCsrfRequest } = require("./backend/csrf");
const { assertDatabaseEnvironmentIsolation } = require("./backend/env-isolation");
const {
  ENDPOINT_BODY_LIMITS,
  MAX_URL_LENGTH,
  REQUEST_LIMIT_POLICY,
  RequestLimitError,
  UPLOAD_POLICY,
  assertRequestSizeHeaders,
  readBoundedBody,
  resolveRequestBodyLimit,
} = require("./backend/request-limits");
const {
  PAYLOAD_SCHEMAS,
  ValidationError,
  validateJsonPayload,
  validateQueryParams,
} = require("./backend/validation");
const {
  buildApiErrorPayload,
  resolveCorrelationId,
} = require("./backend/api-errors");
const {
  createRateLimitBucketKey,
  getClientAddress,
  parseTrustedProxyIps,
} = require("./backend/security");
const {
  hashPasswordResetToken,
  isPasswordValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_REFRESH_TTL_MS,
  SESSION_TTL_MS,
  SessionStore,
  verifyPassword,
} = require("./backend/auth");
const { createEmailMailer } = require("./backend/email");
const { getCouponUnavailableReason } = require("./backend/coupons");
const { createPaymentRoutes } = require("./backend/routes/payments");
const { createPublicRoutes } = require("./backend/routes/public");
const { createOrderRoutes } = require("./backend/routes/orders");
const { createAddressRoutes } = require("./backend/routes/addresses");
const { AddressStore } = require("./backend/addresses");
const { createAuthRoutes } = require("./backend/routes/auth");
const { createPrivacyRoutes } = require("./backend/routes/privacy");
const { createCustomerRoutes } = require("./backend/routes/customers");
const { createServiceRoutes } = require("./backend/routes/services");
const { createAdminRoutes } = require("./backend/routes/admin");
const {
  PRIVACY_DATA_REQUEST_STATUSES,
  PRIVACY_DATA_REQUEST_TYPES,
} = require("./backend/privacy-data-requests");
const {
  EXPORT_DOWNLOAD_TTL_MS,
  PrivacyExportStore,
} = require("./backend/privacy-export");
const { createFirebaseIdTokenVerifier } = require("./backend/firebase-auth");
const {
  CUSTOMER_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  requireCustomerPermission: requireCustomerPermissionMiddleware,
  requireRole: requireRoleMiddleware,
} = require("./backend/authorization");
const {
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  STUDENT_VERIFICATION_STATUSES,
} = require("./backend/business-constants");

const root = __dirname;
const defaultOrdersPath = path.join(root, "data", "orders.jsonl");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};
const customerInteractionQuerySchema = {
  page: { type: "integer", maxLength: 5, min: 1, max: 10000 },
  limit: { type: "integer", maxLength: 3, min: 1, max: 100 },
};
const privacyDataRequestTypes = new Set(PRIVACY_DATA_REQUEST_TYPES);
const privacyDataRequestStatuses = new Set(PRIVACY_DATA_REQUEST_STATUSES);
const publicRootFiles = new Set([
  "admin.css",
  "admin.html",
  "admin.js",
  "404.html",
  "500.html",
  "book-detail.js",
  "book.html",
  "books-data.js",
  "index.html",
  "main.css",
  "main.js",
  "manifest.json",
  "consumer-tax.html",
  "content-rights.html",
  "ecommerce-compliance.html",
  "privacy.html",
  "refund.html",
  "returns.html",
  "robots.txt",
  "shipping.html",
  "sitemap.xml",
  "terms.html",
]);
const catalogBookId = (book) =>
  `catalog-${createHash("sha256").update(book.title).digest("hex")}`;
const catalogBookById = new Map(
  books.map((book) => [catalogBookId(book), book]),
);
const defaultBookStock = 12;
const orderWriteQueues = new Map();
let bookCatalog = new Map(
  books.map((book) => [
    book.title,
    { ...book, id: catalogBookId(book), stock: book.stock ?? defaultBookStock, isCustom: false },
  ]),
);
let catalogBookOverrides = new Map();
const allowedBookCategories = new Set(books.map((book) => book.category));
const defaultCategories = [
  { id: "van-hoc", slug: "van-hoc", name: "Văn học", label: "Văn học", status: "active" },
  { id: "ky-nang", slug: "ky-nang", name: "Kỹ năng sống", label: "Kỹ năng sống", status: "active" },
  { id: "kinh-te", slug: "kinh-te", name: "Kinh tế", label: "Kinh tế", status: "active" },
  { id: "khoa-hoc", slug: "khoa-hoc", name: "Khoa học", label: "Khoa học", status: "active" },
  { id: "lich-su", slug: "lich-su", name: "Lịch sử", label: "Lịch sử", status: "active" },
  { id: "thieu-nhi", slug: "thieu-nhi", name: "Thiếu nhi", label: "Thiếu nhi", status: "active" },
  { id: "trinh-tham", slug: "trinh-tham", name: "Trinh thám", label: "Trinh thám", status: "active" },
  { id: "tam-ly", slug: "tam-ly", name: "Tâm lý", label: "Tâm lý", status: "active" },
  { id: "cong-nghe", slug: "cong-nghe", name: "Công nghệ", label: "Công nghệ", status: "active" },
  { id: "ngoai-ngu", slug: "ngoai-ngu", name: "Ngoại ngữ", label: "Ngoại ngữ", status: "active" },
];
let bookCategories = defaultCategories.map((category) => ({ ...category }));
const allowedDiscountRates = new Set([0, 0.05, 0.1]);
const allowedServiceTypes = new Set(Object.values(SERVICE_TYPES));
const allowedOrderStatuses = new Set(Object.values(ORDER_STATUSES));
const allowedPaymentStatuses = new Set(Object.values(PAYMENT_STATUSES));
const allowedConsentPurposes = new Set(["order", "service", "marketing"]);
const allowedConsentSources = new Set(["web", "admin", "api"]);

function enqueueOrderWrite(ordersPath, operation) {
  const queueKey = path.resolve(ordersPath);
  const previous = orderWriteQueues.get(queueKey) || Promise.resolve();
  const result = previous.then(operation);
  const queueEntry = result.then(() => undefined, () => undefined);
  orderWriteQueues.set(queueKey, queueEntry);
  queueEntry.then(() => {
    if (orderWriteQueues.get(queueKey) === queueEntry) {
      orderWriteQueues.delete(queueKey);
    }
  });
  return result;
}

const payloadSchemas = PAYLOAD_SCHEMAS;
const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://duannhom5-main.onrender.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
    "frame-src https://*.firebaseapp.com https://accounts.google.com",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-site",
};
const customerQuerySchema = {
  search: { type: "string", maxLength: 100 },
  status: {
    type: "string",
    maxLength: 16,
    values: Object.values(CUSTOMER_STATUSES),
  },
  page: { type: "integer", maxLength: 5, min: 1, max: 10000 },
  limit: { type: "integer", maxLength: 3, min: 1, max: 100 },
  sort: { type: "string", maxLength: 32, values: ["createdAt", "name", "status"] },
  order: { type: "string", maxLength: 4, values: ["asc", "desc"] },
};
const listQuerySchema = {
  page: { type: "integer", maxLength: 5, min: 1, max: 10000 },
  limit: { type: "integer", maxLength: 3, min: 1, max: 100 },
  sort: { type: "string", maxLength: 32, values: ["createdAt", "title", "name", "status"] },
  order: { type: "string", maxLength: 4, values: ["asc", "desc"] },
};
const allowedServiceStatuses = new Set(Object.values(SERVICE_STATUSES));
const maxRequestBytes = ENDPOINT_BODY_LIMITS.default;
class RequestError extends Error {
  constructor(status, message, cause) {
    super(message);
    this.status = status;
    this.cause = cause;
  }
}

function getRequestId(request) {
  return resolveCorrelationId(request);
}

function logRequestError(request, requestId, error, message) {
  let pathname = "/";
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    pathname = "<invalid-url>";
  }
  const cause = error && typeof error === "object" ? error.cause : undefined;
  const loggedError = cause || error;
  console.error(JSON.stringify(formatSafeErrorLog({
    requestId,
    method: request.method,
    route: pathname,
    message,
    error: loggedError,
  })));
}

function parseMonitoringAlertUrl(value) {
  const alertUrl = String(value || "").trim();
  if (!alertUrl) return "";
  let parsed;
  try {
    parsed = new URL(alertUrl);
  } catch {
    throw new Error("MONITORING_ALERT_WEBHOOK_URL không phải URL hợp lệ.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("MONITORING_ALERT_WEBHOOK_URL phải dùng HTTPS và không nhúng thông tin đăng nhập.");
  }
  return alertUrl;
}

async function readBackupStatus(statusFile) {
  try {
    const status = JSON.parse(await fs.readFile(statusFile, "utf8"));
    if (!status || typeof status !== "object" || Array.isArray(status) ||
        !["succeeded", "failed"].includes(status.status)) {
      return { status: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
    }
    return {
      status: status.status,
      lastAttemptAt: typeof status.lastAttemptAt === "string" ? status.lastAttemptAt : null,
      lastSuccessAt: typeof status.lastSuccessAt === "string" ? status.lastSuccessAt : null,
      storage: typeof status.storage === "string" ? status.storage : null,
      durationMs: Number.isFinite(status.durationMs) ? status.durationMs : null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { status: "unknown", lastAttemptAt: null, lastSuccessAt: null };
    }
    if (error instanceof SyntaxError) {
      return { status: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
    }
    throw error;
  }
}

function roundMoney(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue);
}

function sendJson(response, status, value, requestMethod = undefined) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(requestMethod === "HEAD" ? undefined : payload);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    role: user.role,
    studentType: user.studentType,
    studentId: user.studentId,
    studentVerification: user.studentVerification || { status: STUDENT_VERIFICATION_STATUSES.PENDING },
    authProvider: user.authProvider || undefined,
    customerInfo: user.customerInfo || {},
  };
}

async function verifySocialIdentity(idToken, socialTokenVerifier) {
  let verified;
  try {
    verified = await socialTokenVerifier(idToken);
  } catch {
    throw new RequestError(401, "Thông tin xác thực social không hợp lệ hoặc đã hết hạn.");
  }
  const email = sanitizePlainText(String(verified?.email || ""), 254).toLowerCase();
  const name = sanitizePlainText(String(verified?.name || ""), 120) || email.split("@")[0];
  const provider = String(verified?.provider || "").trim().toLowerCase();
  const providerId = sanitizePlainText(String(verified?.uid || ""), 128);
  if (
    verified?.emailVerified !== true ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !SOCIAL_PROVIDERS.has(provider) ||
    !providerId
  ) {
    throw new RequestError(401, "Thông tin xác thực social chưa được xác minh đầy đủ.");
  }
  return { email, name, provider, providerId };
}

async function sendHtmlError(response, status, pageName) {
  const errorPagePath = path.join(root, `${pageName}.html`);
  try {
    const contents = await fs.readFile(errorPagePath);
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Length": contents.length,
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
    return;
  } catch {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(
      status === 404
        ? "Không tìm thấy trang."
        : "Không thể xử lý yêu cầu. Vui lòng thử lại.",
    );
  }
}

async function readJson(request, maxBytes, limitOverrides = {}) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestError(415, "Yêu cầu phải gửi ở định dạng JSON.");
  }

  const rawBody = await readRawBody(request, maxBytes, limitOverrides);
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new RequestError(400, "Dữ liệu yêu cầu không hợp lệ.");
  }
  return payload;
}

async function readRawBody(request, maxBytes, limitOverrides = {}) {
  let pathname = "/";
  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    pathname = "/";
  }
  const resolved = resolveRequestBodyLimit(pathname, {
    contentType: request.headers?.["content-type"] || "",
    overrides: limitOverrides,
  });
  const effectiveMax = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : resolved.maxBytes;
  return readBoundedBody(request, effectiveMax, { category: resolved.category });
}

function sanitizePlainText(value, maxLength = 0) {
  if (typeof value !== "string") {
    return "";
  }

  let cleaned = value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/<\s*script\b[\s\S]*?<\/\s*script\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:javascript\s*:|data\s*:\s*text\/html|vbscript\s*:|on\w+\s*=)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (maxLength > 0 && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trim();
  }

  return cleaned;
}

function isBookDiscontinued(book) {
  if (!book) return true;
  if (book.deletedAt || book.deleted === true) return true;
  if (book.isActive === false || book.enabled === false) return true;
  if (book.discontinued === true) return true;
  if (
    typeof book.status === "string" &&
    ["discontinued", "inactive", "deleted", "unavailable"].includes(
      book.status.trim().toLowerCase(),
    )
  ) {
    return true;
  }
  return false;
}

function normalizeAuthorIdentifier(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeAdminBook(payload, existing) {
  const title = payload.title === undefined
    ? existing?.title
    : sanitizePlainText(payload.title, 200);
  const author = payload.author === undefined
    ? existing?.author
    : sanitizePlainText(payload.author, 200);
  const publisher = payload.publisher === undefined
    ? existing?.publisher
    : sanitizePlainText(payload.publisher, 200);
  const publisherId = payload.publisherId === undefined
    ? existing?.publisherId
    : normalizeAuthorIdentifier(payload.publisherId);
  const category = payload.category === undefined
    ? existing?.category
    : sanitizePlainText(payload.category, 64);
  const price = payload.price === undefined ? existing?.price : payload.price;
  const stock = payload.stock === undefined ? existing?.stock : payload.stock;
  const status = payload.status === undefined
    ? existing?.status
    : sanitizePlainText(payload.status, 32).toLowerCase();

  if (!title) {
    throw new RequestError(400, "Vui lòng nhập tên sách.");
  }
  if (!allowedBookCategories.has(category)) {
    throw new RequestError(400, "Thể loại sách không hợp lệ.");
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new RequestError(400, "Giá sách phải là số không âm.");
  }
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000_000) {
    throw new RequestError(400, "Tồn kho phải là số nguyên từ 0 đến 1.000.000.000.");
  }
  if (
    status !== undefined &&
    !["active", "discontinued", "inactive"].includes(status)
  ) {
    throw new RequestError(400, "Trạng thái sách không hợp lệ.");
  }

  const normalized = {
    title,
    author,
    authorIds: Array.isArray(payload.authorIds)
      ? payload.authorIds.map((value) => normalizeAuthorIdentifier(value)).filter(Boolean)
      : [],
    authors: Array.isArray(payload.authors)
      ? payload.authors.map((value) => sanitizePlainText(value, 200)).filter(Boolean)
      : [],
    publisher,
    publisherId,
    category,
    price,
    stock,
    cover: payload.cover === undefined
      ? existing?.cover || ""
      : sanitizePlainText(payload.cover, 500),
    description: payload.description === undefined
      ? existing?.description || ""
      : sanitizePlainText(payload.description, 1000),
  };
  if (payload.isActive !== undefined || existing?.isActive !== undefined) {
    normalized.isActive = payload.isActive !== undefined
      ? payload.isActive
      : existing.isActive;
  }
  if (payload.discontinued !== undefined || existing?.discontinued !== undefined) {
    normalized.discontinued = payload.discontinued !== undefined
      ? payload.discontinued
      : existing.discontinued;
  }
  if (status !== undefined) {
    normalized.status = status;
  }
  return normalized;
}

function normalizeCoupon(payload, code) {
  const normalizedCode = sanitizePlainText(code, 32).toUpperCase();
  const label = sanitizePlainText(payload.label, 120);
  const rate = payload.rate;
  const minSubtotal = payload.minSubtotal;
  const maxUses = payload.maxUses === 0 ? null : payload.maxUses;
  const startsAt = payload.startsAt
    ? new Date(payload.startsAt)
    : null;
  const expiresAt = payload.expiresAt
    ? new Date(payload.expiresAt)
    : null;

  if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedCode)) {
    throw new RequestError(400, "Mã coupon chỉ được gồm 3-32 ký tự A-Z, 0-9, dấu gạch ngang hoặc gạch dưới.");
  }
  if (!label || !Number.isFinite(rate) || rate < 0.01 || rate > 0.3) {
    throw new RequestError(400, "Tên coupon và mức giảm từ 1% đến 30% là bắt buộc.");
  }
  if (!Number.isSafeInteger(minSubtotal) || minSubtotal < 0 || minSubtotal > 1_000_000_000_000) {
    throw new RequestError(400, "Giá trị đơn hàng tối thiểu không hợp lệ.");
  }
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 2_147_483_647)) {
    throw new RequestError(400, "Giới hạn lượt dùng phải là số nguyên dương.");
  }
  if (
    (startsAt && !Number.isFinite(startsAt.getTime())) ||
    (expiresAt && !Number.isFinite(expiresAt.getTime())) ||
    (startsAt && expiresAt && expiresAt <= startsAt)
  ) {
    throw new RequestError(400, "Thời gian áp dụng coupon không hợp lệ.");
  }

  return {
    code: normalizedCode,
    label,
    rate,
    minSubtotal,
    maxUses,
    startsAt: startsAt ? startsAt.toISOString() : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    enabled: payload.enabled,
  };
}

function sanitizePayload(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizePlainText(value, 2000);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RequestError(400, "Dữ liệu yêu cầu chứa thuộc tính không hợp lệ.");
    }

    const cleaned = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      cleaned[key] = sanitizePayload(nested);
    }
    return cleaned;
  }

  return value;
}

function requireJsonObject(
  payload,
  message = "Dữ liệu yêu cầu không hợp lệ.",
  schema,
) {
  return validateJsonPayload(payload, schema, { message, sanitizePayload });
}

function validateQuery(requestUrl, schema, message) {
  return validateQueryParams(requestUrl, schema, message);
}

function paginateList(records, query, defaultSort, defaultLimit = 50) {
  const page = query.page || 1;
  const limit = query.limit || defaultLimit;
  const sort = query.sort || defaultSort;
  const direction = query.order === "asc" ? 1 : -1;
  const sorted = [...records].sort((left, right) => {
    const rawLeftValue = left?.[sort] ?? "";
    const rawRightValue = right?.[sort] ?? "";
    const compared = typeof rawLeftValue === "number" && typeof rawRightValue === "number"
      ? rawLeftValue - rawRightValue
      : String(rawLeftValue).toLocaleLowerCase("vi")
        .localeCompare(String(rawRightValue).toLocaleLowerCase("vi"), "vi");
    if (compared !== 0) return compared * direction;
    return String(left?.id || left?.orderId || left?.title || "")
      .localeCompare(String(right?.id || right?.orderId || right?.title || ""), "vi") * direction;
  });
  const total = sorted.length;
  const items = sorted.slice((page - 1) * limit, page * limit);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      sort,
      order: query.order || "desc",
    },
  };
}

function sendPaginatedJson(response, result) {
  response.setHeader("X-Pagination", JSON.stringify(result.pagination));
  sendJson(response, 200, result.items);
}

function validateApiPath(pathname) {
  if (!pathname.startsWith("/api/")) return;
  for (const segment of pathname.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new RequestError(400, "Đường dẫn yêu cầu không hợp lệ.");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      throw new RequestError(400, "Đường dẫn yêu cầu không hợp lệ.");
    }
  }
}

function createOrder(payload, userId = null, requester = null, coupon = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError(400, "Dữ liệu đơn hàng không hợp lệ.");
  }
  if (
    typeof payload.customerName !== "string" ||
    typeof payload.address !== "string" ||
    typeof payload.phone !== "string"
  ) {
    throw new RequestError(400, "Vui lòng kiểm tra thông tin nhận hàng.");
  }

  const customerName = sanitizePlainText(
    payload.customerName,
    120,
  );
  const address = sanitizePlainText(
    payload.address,
    300,
  );
  const phone = sanitizePlainText(
    payload.phone,
    20,
  );
  const paymentMethod = sanitizePlainText(
    typeof payload.paymentMethod === "string" ? payload.paymentMethod : "",
    32,
  );
  const isStudentAccount =
    requester?.studentVerification?.status === STUDENT_VERIFICATION_STATUSES.VERIFIED &&
    (requester?.studentType === "student" || requester?.studentType === "university");
  const discountRate = requester ? (isStudentAccount ? 0.1 : 0.05) : 0;
  const couponCode = sanitizePlainText(
    typeof payload.couponCode === "string" ? payload.couponCode : "",
    32,
  ).toUpperCase();

  if (customerName.length < 2 || customerName.length > 120) {
    throw new RequestError(400, "Vui lòng kiểm tra họ tên người nhận.");
  }
  if (address.length < 10 || address.length > 300) {
    throw new RequestError(400, "Vui lòng kiểm tra địa chỉ nhận hàng.");
  }
  if (!/^[0-9 +()-]{8,20}$/.test(phone)) {
    throw new RequestError(400, "Vui lòng kiểm tra số điện thoại.");
  }
  if (phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 15) {
    throw new RequestError(400, "Vui lòng kiểm tra số điện thoại.");
  }
  if (!["transfer", "cod"].includes(paymentMethod)) {
    throw new RequestError(400, "Phương thức thanh toán không hợp lệ.");
  }
  if (
    payload.discountRate !== undefined &&
    !allowedDiscountRates.has(payload.discountRate)
  ) {
    throw new RequestError(400, "Mức giảm giá không hợp lệ.");
  }
  if (
    payload.couponCode !== undefined &&
    payload.couponCode !== null &&
    typeof payload.couponCode !== "string"
  ) {
    throw new RequestError(400, "Mã ưu đãi không hợp lệ hoặc đã hết hạn.");
  }
  if (couponCode && (!coupon || coupon.code !== couponCode)) {
    throw new RequestError(400, "Mã ưu đãi không hợp lệ hoặc đã hết hạn.");
  }
  if (
    !Array.isArray(payload.items) ||
    payload.items.length === 0 ||
    payload.items.length > 50
  ) {
    throw new RequestError(400, "Giỏ hàng trống hoặc có quá nhiều loại sách.");
  }

  const quantities = new Map();
  for (const item of payload.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RequestError(400, "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.");
    }
    const safeTitle = sanitizePlainText(
      item && typeof item.title === "string" ? item.title : "",
      200,
    );
    const book = safeTitle ? bookCatalog.get(safeTitle) : null;
    const stock =
      Number.isInteger(book && book.stock) && book.stock >= 0
        ? book.stock
        : defaultBookStock;
    if (!book) {
      throw new RequestError(
        400,
        "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.",
      );
    }
    if (isBookDiscontinued(book)) {
      throw new RequestError(
        400,
        "Sách đã ngừng kinh doanh hoặc không còn bán.",
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RequestError(400, "Số lượng sách phải là số nguyên lớn hơn 0.");
    }
    if (stock <= 0 || item.quantity > stock) {
      throw new RequestError(400, "Số lượng sách vượt quá tồn kho.");
    }
    quantities.set(
      book.title,
      (quantities.get(book.title) || 0) + item.quantity,
    );
    if (quantities.get(book.title) > stock) {
      throw new RequestError(400, "Số lượng sách vượt quá tồn kho.");
    }
  }

  const orderItems = [...quantities].map(([title, quantity]) => {
    const book = bookCatalog.get(title);
    const unitPrice = roundMoney(book.price);
    if (
      !Number.isFinite(book.price) ||
      book.price < 0 ||
      !Number.isSafeInteger(unitPrice) ||
      !Number.isSafeInteger(unitPrice * quantity)
    ) {
      throw new RequestError(400, "Giá sách không hợp lệ.");
    }
    return {
      title: book.title,
      author: book.author,
      unitPrice,
      quantity,
      lineTotal: unitPrice * quantity,
    };
  });
  const subtotal = orderItems.reduce(
    (total, item) => total + item.lineTotal,
    0,
  );
  if (!Number.isSafeInteger(subtotal)) {
    throw new RequestError(400, "Tổng giá trị đơn hàng không hợp lệ.");
  }
  const couponReason = couponCode
    ? getCouponUnavailableReason(coupon, { subtotal })
    : "";
  if (couponReason) throw new RequestError(400, couponReason);
  const couponRate = couponCode ? coupon.rate : 0;
  const discount = roundMoney(
    subtotal * Math.min(discountRate + couponRate, 0.3),
  );

  const order = {
    orderId: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "received",
    paymentStatus: paymentMethod === "transfer" ? "pending" : "cod_pending",
    paymentCode: paymentMethod === "transfer"
      ? `BN${randomBytes(6).toString("hex").toUpperCase()}`
      : null,
    customerName,
    phone,
    address,
    paymentMethod,
    discountRate,
    couponCode: couponCode || null,
    couponRate,
    subtotal,
    discount,
    total: subtotal - discount,
    items: orderItems,
  };

  if (userId && typeof userId === "string" && userId.trim()) {
    order.userId = userId.trim();
  }

  return order;
}

function createUpdatedOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new RequestError(400, "Danh sách sản phẩm cập nhật không hợp lệ.");
  }
  const quantities = new Map();
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some((field) => !["title", "quantity"].includes(field))
    ) {
      throw new RequestError(400, "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.");
    }
    const title = sanitizePlainText(typeof item.title === "string" ? item.title : "", 200);
    const book = title ? bookCatalog.get(title) : null;
    if (!book) {
      throw new RequestError(400, "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.");
    }
    if (isBookDiscontinued(book)) {
      throw new RequestError(
        400,
        "Sách đã ngừng kinh doanh hoặc không còn bán.",
      );
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new RequestError(400, "Số lượng sách phải là số nguyên lớn hơn 0.");
    }
    const stock =
      Number.isInteger(book && book.stock) && book.stock >= 0
        ? book.stock
        : defaultBookStock;
    const quantity = (quantities.get(book.title) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw new RequestError(400, "Số lượng sách không hợp lệ.");
    }
    if (stock <= 0 || quantity > stock) {
      throw new RequestError(400, "Số lượng sách vượt quá tồn kho.");
    }
    quantities.set(book.title, quantity);
  }

  return [...quantities].map(([title, quantity]) => {
    const book = bookCatalog.get(title);
    const unitPrice = roundMoney(book.price);
    if (
      !Number.isFinite(book.price) ||
      book.price < 0 ||
      !Number.isSafeInteger(unitPrice) ||
      !Number.isSafeInteger(unitPrice * quantity)
    ) {
      throw new RequestError(400, "Giá sách không hợp lệ.");
    }
    return {
      title: book.title,
      author: book.author,
      unitPrice,
      quantity,
      lineTotal: unitPrice * quantity,
    };
  });
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    ...(order.paymentCode ? { paymentCode: order.paymentCode } : {}),
    couponCode: order.couponCode,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    items: order.items.map(({ title, quantity, lineTotal }) => ({
      title,
      quantity,
      lineTotal,
    })),
  };
}

function staticFilePath(pathname, staticRoot) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new RequestError(400, "Đường dẫn không hợp lệ.");
  }
  const rootPath = path.resolve(staticRoot);
  const requestedPath = path.resolve(
    rootPath,
    `.${decodedPath === "/" ? "/index.html" : decodedPath}`,
  );
  if (!requestedPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new RequestError(404, "Không tìm thấy trang.");
  }
  const relativePath = path.relative(rootPath, requestedPath);
  const pathParts = relativePath.split(path.sep);
  if (
    pathParts.some((part) => part.startsWith(".")) ||
    (pathParts.length === 1 && !publicRootFiles.has(pathParts[0])) ||
    (pathParts.length > 1 && pathParts[0] !== "assets")
  ) {
    throw new RequestError(404, "Không tìm thấy trang.");
  }
  return requestedPath;
}

async function serveStatic(request, response, pathname, staticRoot) {
  let filePath;
  try {
    filePath = staticFilePath(pathname, staticRoot);
  } catch (error) {
    if (error instanceof RequestError) {
      await sendHtmlError(response, error.status, "404");
      return;
    }
    throw error;
  }

  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      await sendHtmlError(response, 404, "404");
      return;
    }
    throw error;
  }

  const contentType =
    mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    "Cache-Control": contentType.startsWith("image/")
      ? "public, max-age=86400, stale-while-revalidate=604800"
      : "no-cache",
    "Content-Length": contents.length,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : contents);
}

function createServer({
  ordersPath = defaultOrdersPath,
  staticRoot = root,
  usersPath,
  customersPath,
  servicesPath,
  booksPath,
  categoriesPath,
  authorsPath,
  publishersPath,
  couponsPath,
  customerInteractionsPath,
  consentRecordsPath,
  privacyDataRequestsPath,
  auditLogPath = path.join(root, "data", "admin-audit.jsonl"),
  addressesPath = path.join(root, "data", "addresses.json"),
  uploadsDir = path.join(root, "data", "uploads", "book-covers"),
  requestBodyLimits = {},
  uploadMaxBytes = UPLOAD_POLICY.maxFileBytes,
  backupStatusFile = path.resolve(
    process.env.BACKUP_STATUS_FILE || path.join(root, "data", "backup-status.json"),
  ),
  monitoringAlertUrl = process.env.MONITORING_ALERT_WEBHOOK_URL || "",
  monitoringAlertFetch = globalThis.fetch,
  monitoringAlertCooldownMs = 15 * 60 * 1000,
  database,
  rateLimitHmacKey = process.env.RATE_LIMIT_HMAC_KEY ||
    (String(process.env.NODE_ENV || "").toLowerCase() === "production"
      ? ""
      : "booknest-local-rate-limit-hmac-secret-0000"),
  trustedProxyHops = process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS === undefined
    ? 0
    : Number(process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS),
  trustedProxyIps = process.env.RATE_LIMIT_TRUSTED_PROXY_IPS || "",
  paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "",
  sepayApiKey = process.env.SEPAY_API_KEY || "",
  sepayBankCode = process.env.SEPAY_BANK_CODE || "",
  sepayBankName = process.env.SEPAY_BANK_NAME || "",
  sepayAccountNumber = process.env.SEPAY_ACCOUNT_NUMBER || "",
  sepayAccountName = process.env.SEPAY_ACCOUNT_NAME || "",
  sessionTtlMs = Number.isFinite(Number(process.env.SESSION_TTL_MS))
    ? Number(process.env.SESSION_TTL_MS)
    : SESSION_TTL_MS,
  idleTimeoutMs = Number.isFinite(Number(process.env.SESSION_IDLE_TIMEOUT_MS))
    ? Number(process.env.SESSION_IDLE_TIMEOUT_MS)
    : SESSION_IDLE_TIMEOUT_MS,
  refreshTtlMs = Number.isFinite(Number(process.env.SESSION_REFRESH_TTL_MS))
    ? Number(process.env.SESSION_REFRESH_TTL_MS)
    : SESSION_REFRESH_TTL_MS,
  privacyExportTtlMs = Number.isFinite(Number(process.env.PRIVACY_EXPORT_TTL_MS))
    ? Number(process.env.PRIVACY_EXPORT_TTL_MS)
    : EXPORT_DOWNLOAD_TTL_MS,
  passwordResetMailer = createEmailMailer(),
  socialTokenVerifier = createFirebaseIdTokenVerifier(),
  appBaseUrl = process.env.PUBLIC_APP_URL,
  corsOrigins = process.env.CORS_ORIGINS || (
    process.env.RENDER
      ? "https://duongcongcao-0312.github.io"
      : "http://127.0.0.1:8000,http://localhost:8000"
  ),
  loginAttemptLimit = 5,
  loginAttemptWindowMs = 15 * 60 * 1000,
  loginAccountAttemptLimit = 10,
  loginAccountWindowMs = 15 * 60 * 1000,
  registrationAttemptLimit = 5,
  registrationAttemptWindowMs = 15 * 60 * 1000,
  passwordResetIpLimit = 30,
  passwordResetEmailLimit = 5,
  passwordResetWindowMs = 15 * 60 * 1000,
  passwordResetTtlMs = 60 * 60 * 1000,
  emailVerificationTtlMs = 24 * 60 * 60 * 1000,
  orderRequestLimit = 30,
  orderRequestWindowMs = 15 * 60 * 1000,
} = {}) {
  if (process.env.DATABASE_URL && !database) {
    assertDatabaseEnvironmentIsolation(process.env);
  }
  if (process.env.NODE_ENV === "production") {
    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim();
    const adminPassword = String(process.env.ADMIN_PASSWORD || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminPassword.length < 12) {
      throw new Error(
        "Production requires a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.",
      );
    }
  }
  if (typeof rateLimitHmacKey !== "string" || Buffer.byteLength(rateLimitHmacKey) < 32) {
    throw new Error("RATE_LIMIT_HMAC_KEY must contain at least 32 bytes.");
  }
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new RangeError("RATE_LIMIT_TRUSTED_PROXY_HOPS must be a non-negative integer.");
  }
  const trustedProxyIpList = parseTrustedProxyIps(trustedProxyIps);
  if (trustedProxyHops > 0 && trustedProxyIpList.length === 0) {
    throw new Error("RATE_LIMIT_TRUSTED_PROXY_IPS is required when proxy hops are trusted.");
  }

  const sepayConfiguration = normalizeSePayConfig({
    apiKey: sepayApiKey,
    bankCode: sepayBankCode,
    bankName: sepayBankName,
    accountNumber: sepayAccountNumber,
    accountName: sepayAccountName,
  });
  const invalidPaymentDisplaySettings = sepayConfiguration.invalid.filter(
    (setting) => setting !== "SEPAY_API_KEY",
  );

  if (process.env.RENDER && !database && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL phải được cấu hình trên Render trước khi chạy backend.");
  }

  let persistenceQueue = Promise.resolve();
  const hasExplicitFilePaths = Boolean(
    ordersPath !== defaultOrdersPath ||
    usersPath ||
    customersPath ||
    servicesPath ||
    booksPath ||
    categoriesPath ||
    authorsPath ||
    publishersPath ||
    couponsPath ||
    customerInteractionsPath ||
    consentRecordsPath,
  );
  const db = database || (process.env.DATABASE_URL && !hasExplicitFilePaths
    ? new PostgresDatabase()
    : new Database({
      root,
      ordersPath,
      usersPath,
      customersPath,
      servicesPath,
      booksPath,
      categoriesPath,
      authorsPath,
      publishersPath,
      couponsPath,
      customerInteractionsPath,
      consentRecordsPath,
      privacyDataRequestsPath,
      auditLogPath,
    }));
  const sessionRepositoryMethods = [
    "saveSessionRecord",
    "getSessionRecord",
    "deleteSessionRecord",
    "deleteUserSessionRecords",
    "pruneExpiredSessionRecords",
  ];
  const sessionRepository = sessionRepositoryMethods.every(
    (method) => typeof db[method] === "function",
  )
    ? db
    : null;
  if (process.env.NODE_ENV === "production" && !sessionRepository) {
    throw new Error("Production requires a shared PostgreSQL session store.");
  }
  if (db && typeof db === "object") {
    db.auditLogPath = auditLogPath;
  }

  function getRequestClientAddress(request) {
    return getClientAddress(request, trustedProxyHops, trustedProxyIpList);
  }

  async function rateLimitRequest(
    response,
    scope,
    identity,
    limit,
    windowMs,
    message,
  ) {
    const bucketKey = createRateLimitBucketKey(rateLimitHmacKey, scope, identity);
    let result;
    try {
      if (typeof db.consumeRateLimit !== "function") {
        const error = new Error("Rate-limit storage is unavailable.");
        error.code = "RATE_LIMIT_STORE_UNAVAILABLE";
        throw error;
      }
      result = await db.consumeRateLimit(bucketKey, limit, windowMs, Date.now());
      if (
        !result ||
        typeof result.allowed !== "boolean" ||
        !Number.isSafeInteger(result.resetAt)
      ) {
        throw new Error("Rate-limit storage returned an invalid result.");
      }
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "rate_limit_store_failure",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
      }));
      throw new RequestError(
        503,
        "Tạm thời không thể kiểm tra giới hạn yêu cầu. Vui lòng thử lại sau.",
      );
    }

    if (!result.allowed) {
      response.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      );
      throw new RequestError(429, message);
    }
    return bucketKey;
  }

  async function clearRateLimit(scope, identity) {
    const bucketKey = createRateLimitBucketKey(rateLimitHmacKey, scope, identity);
    try {
      if (typeof db.clearRateLimit !== "function") {
        const error = new Error("Rate-limit storage is unavailable.");
        error.code = "RATE_LIMIT_STORE_UNAVAILABLE";
        throw error;
      }
      await db.clearRateLimit(bucketKey);
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "rate_limit_store_clear_failed",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
      }));
    }
  }

  const monitoringMetrics = new MonitoringMetrics();
  const startedAt = Date.now();
  const alertUrl = parseMonitoringAlertUrl(monitoringAlertUrl);
  if (typeof monitoringAlertCooldownMs !== "number" ||
      !Number.isFinite(monitoringAlertCooldownMs) ||
      monitoringAlertCooldownMs < 0) {
    throw new RangeError("monitoringAlertCooldownMs must be a non-negative number.");
  }
  const sessionStore = new SessionStore({
    repository: sessionRepository,
    sessionTtlMs,
    idleTimeoutMs,
    refreshTtlMs,
    cleanupIntervalMs: 60 * 1000,
  });
  const privacyExportStore = new PrivacyExportStore({
    ttlMs: privacyExportTtlMs,
  });

  function dispatchMonitoringAlert(alert, requestId) {
    const now = Date.now();
    if (!monitoringMetrics.shouldSendAlert(alert.event, now, monitoringAlertCooldownMs)) return;
    const payload = {
      event: alert.event,
      severity: alert.severity,
      timestamp: new Date(now).toISOString(),
      service: "BookNest",
      count: alert.count,
      threshold: alert.threshold,
      requestId: redactLogText(requestId),
      text: `BookNest alert: ${alert.event} (${alert.count}; ${alert.threshold}).`,
    };
    console.warn(JSON.stringify({ level: "warn", event: "monitoring_alert", ...payload }));
    if (!alertUrl) return;

    void (async () => {
      try {
        if (typeof monitoringAlertFetch !== "function") {
          throw new Error("No fetch implementation is available for monitoring alerts.");
        }
        const response = await monitoringAlertFetch(alertUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Alert endpoint returned HTTP ${response.status}.`);
      } catch (error) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "monitoring_alert_delivery_failed",
          message: redactLogText(error.message),
        }));
      }
    })();
  }

  async function getDatabaseMonitoringStatus(requestId) {
    let status;
    try {
      if (typeof db.getMonitoringStatus === "function") {
        status = await db.getMonitoringStatus();
      } else {
        await db.init();
        status = {
          status: "healthy",
          storage: process.env.DATABASE_URL ? "postgresql" : "file",
          connections: null,
        };
      }
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "database_health_check_failed",
        requestId: redactLogText(requestId),
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
      }));
      status = {
        status: "unavailable",
        storage: process.env.DATABASE_URL ? "postgresql" : "file",
        connections: null,
      };
    }
    if (status.status !== "healthy") {
      dispatchMonitoringAlert({
        event: "database_unavailable",
        severity: "critical",
        count: 1,
        threshold: "database health check failed",
      }, requestId);
    }
    return status;
  }

  async function verifyPasswordReauthentication(request, response, user, password) {
    const address = getRequestClientAddress(request);
    await rateLimitRequest(
      response,
      "reauthentication",
      address,
      loginAttemptLimit,
      loginAttemptWindowMs,
      "Bạn đã thử xác thực lại quá nhiều lần. Vui lòng thử lại sau 15 phút.",
    );
    if (
      user.passwordAuthEnabled === false ||
      !verifyPassword(password, user.password)
    ) {
      throw new RequestError(401, "Email hoặc mật khẩu không chính xác.");
    }
    await clearRateLimit("reauthentication", address);
  }
  const allowedOrigins = new Set(
    corsOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  let catalogLoadError;
  async function loadCatalog() {
    try {
      const [custom, overrides] = await Promise.all([
        db.getCustomBooks(),
        typeof db.getCatalogBookOverrides === "function"
          ? db.getCatalogBookOverrides()
          : Promise.resolve([]),
      ]);
      const refreshedCatalog = new Map(
        books.map((book) => [
          book.title,
          { ...book, id: catalogBookId(book), stock: book.stock ?? defaultBookStock, isCustom: false },
        ]),
      );
      const refreshedOverrides = new Map();
      for (const override of overrides) {
        const baseBook = catalogBookById.get(override.id);
        if (!baseBook) continue;
        if (override.title !== baseBook.title) refreshedCatalog.delete(baseBook.title);
        refreshedOverrides.set(override.id, override);
        refreshedCatalog.set(override.title, {
          ...baseBook,
          stock: defaultBookStock,
          ...override,
          id: override.id,
          isCustom: false,
        });
      }
      for (const book of custom) {
        if (book && book.title) {
          refreshedCatalog.set(book.title, { ...book, isCustom: true });
        }
      }
      bookCatalog = refreshedCatalog;
      catalogBookOverrides = refreshedOverrides;
      catalogLoadError = null;
    } catch (error) {
      catalogLoadError = error;
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "catalog_load_failed",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
        message: redactLogText(error?.message),
      }));
    }
  }

  let catalogReady = loadCatalog();
  let catalogRetry;

  async function waitForCatalogReady() {
    await catalogReady;
    if (!catalogLoadError) return;
    if (!catalogRetry) {
      catalogRetry = loadCatalog().finally(() => {
        catalogReady = catalogRetry;
        catalogRetry = null;
      });
    }
    await catalogRetry;
    if (catalogLoadError) throw catalogLoadError;
  }

  async function createAndPersistOrder(payload, userId, requester, idempotencyKey) {
    await waitForCatalogReady();
    return enqueueOrderWrite(ordersPath, async () => {
      const couponCode = typeof payload?.couponCode === "string"
        ? sanitizePlainText(payload.couponCode, 32).toUpperCase()
        : "";
      const existingOrders = await db.getAllOrders(ordersPath);
      const existingOrder = existingOrders.find(
        (entry) => entry.idempotencyKey === idempotencyKey,
      );
      if (existingOrder) {
        if (existingOrder.couponCode !== (couponCode || null)) {
          throw new RequestError(
            409,
            "Idempotency-Key đã được sử dụng cho nội dung đơn hàng khác.",
          );
        }
        let replayCoupon = null;
        if (couponCode) {
          const currentCoupons = await db.getCoupons();
          const currentCoupon = currentCoupons.find((entry) => entry.code === couponCode);
          const rate = Number.isFinite(existingOrder.couponRate)
            ? existingOrder.couponRate
            : currentCoupon?.rate;
          if (!Number.isFinite(rate)) {
            throw new RequestError(409, "Không thể phát lại đơn hàng đã sử dụng coupon này.");
          }
          replayCoupon = {
            code: couponCode,
            rate,
            minSubtotal: 0,
            maxUses: null,
            usedCount: 0,
            enabled: true,
          };
        }
        const replayOrder = createOrder(payload, userId, requester, replayCoupon);
        if (!userId) replayOrder.accessCodeHash = hashOrderAccessCode(payload.accessCode);
        const replayHash = hashOrderRequest(replayOrder);
        const existingHash = existingOrder.idempotencyHash || hashOrderRequest(existingOrder);
        if (existingHash !== replayHash) {
          throw new RequestError(
            409,
            "Idempotency-Key đã được sử dụng cho nội dung đơn hàng khác.",
          );
        }
        return { order: existingOrder, replayed: true };
      }

      const coupons = couponCode ? await db.getCoupons() : [];
      const coupon = coupons.find((entry) => entry.code === couponCode) || null;
      const order = createOrder(payload, userId, requester, coupon);
      if (!userId) order.accessCodeHash = hashOrderAccessCode(payload.accessCode);
      const requestHash = hashOrderRequest(order);
      order.idempotencyKey = idempotencyKey;
      order.idempotencyHash = requestHash;

      const validateStock = (existingOrders) => {
        const reserved = new Map();
        for (const existingOrder of existingOrders) {
          if (existingOrder.status === "cancelled") continue;
          for (const item of existingOrder.items || []) {
            reserved.set(
              item.title,
              (reserved.get(item.title) || 0) + Number(item.quantity || 0),
            );
          }
        }
        for (const item of order.items) {
          const book = bookCatalog.get(item.title);
          const stock =
            Number.isInteger(book && book.stock) && book.stock >= 0
              ? book.stock
              : defaultBookStock;
          if ((reserved.get(item.title) || 0) + item.quantity > stock) {
            throw new RequestError(400, "Số lượng sách vượt quá tồn kho.");
          }
        }
      };

      if (typeof db.addOrderIdempotently === "function") {
        const inventory = order.items.map((item) => {
          const book = bookCatalog.get(item.title);
          return {
            title: item.title,
            quantity: item.quantity,
            stock:
              Number.isInteger(book && book.stock) && book.stock >= 0
                ? book.stock
                : defaultBookStock,
          };
        });
        const result = await db.addOrderIdempotently(
          order,
          requestHash,
          inventory,
          validateStock,
          couponCode || null,
        );
        if (result.conflict) {
          throw new RequestError(
            409,
            "Idempotency-Key đã được sử dụng cho nội dung đơn hàng khác.",
          );
        }
        return result;
      }

      validateStock(existingOrders);
      if (couponCode) {
        await db.redeemCoupon(
          couponCode,
          order.subtotal,
          Date.now(),
          order.couponRate,
        );
      }
      try {
        await db.addOrder(order, ordersPath);
      } catch (error) {
        if (couponCode) await db.releaseCoupon(couponCode);
        throw error;
      }
      return { order, replayed: false };
    });
  }

  async function getAuthUser(request) {
    const token = extractSessionToken(request);
    return await sessionStore.getSession(token);
  }

  async function auditSensitiveRequest(request, response, requestUrl) {
    const pathname = requestUrl.pathname;
    const isAdminRequest = pathname.startsWith("/api/admin/");
    const isSensitiveRequest = isAdminRequest ||
      pathname === "/api/orders" ||
      /^\/api\/orders\/[0-9a-f-]{36}(?:\/status)?$/i.test(pathname) ||
      pathname === "/api/auth/customer-info" ||
      pathname.startsWith("/api/privacy/consents") ||
      pathname.startsWith("/api/privacy/data-requests") ||
      pathname.startsWith("/api/privacy/exports") ||
      /^\/api\/auth\/social\/(?:link|unlink)$/.test(pathname);
    if (!isSensitiveRequest) return;

    const actor = await getAuthUser(request);
    await appendAuditEntry(auditLogPath, {
      action: isAdminRequest ? "admin.api.request" : "sensitive.api.request",
      actorId: actor?.userId || null,
      actorRole: actor?.role || "anonymous",
      entityType: isAdminRequest ? "admin_api" : "sensitive_api",
      entityId: pathname,
      outcome: "attempt",
      requestId: response.getHeader("X-Request-Id"),
      metadata: {
        method: request.method,
        route: pathname,
      },
    });
  }

  async function auditAdminRequestFailure(request, requestId, status) {
    let pathname = "";
    try {
      const parsedPath = new URL(request.url || "/", "http://localhost").pathname;
      const versionInfo = resolveApiVersion(parsedPath);
      if (versionInfo.unsupportedVersion) return;
      pathname = versionInfo.canonicalPath;
    } catch {
      return;
    }
    if (!pathname.startsWith("/api/admin/")) return;
    const isDenied = status === 401 || status === 403;
    try {
      const actor = await getAuthUser(request).catch(() => null);
      await appendAuditEntry(auditLogPath, {
        action: isDenied ? "admin.api.denied" : "admin.api.failure",
        actorId: actor?.userId || null,
        actorRole: actor?.role || "anonymous",
        entityType: "admin_api",
        entityId: pathname,
        outcome: isDenied ? "denied" : "failure",
        statusCode: status,
        requestId,
        metadata: {
          method: request.method,
          route: pathname,
          statusCode: status,
        },
      });
    } catch {
      // Do not mask the primary HTTP error response if audit write fails.
    }
  }

  async function requireCustomerPermission(request, permission) {
    return requireCustomerPermissionMiddleware(
      request,
      permission,
      sessionStore,
      RequestError,
    );
  }

  async function requireRole(request, permission) {
    return requireRoleMiddleware(request, permission, sessionStore, RequestError);
  }

  async function requireAdmin(request) {
    return requireRole(request, "read:dashboard");
  }

  function applyCustomerFilters(customers, { search = "", status = "", page = 1, limit = 20 } = {}) {
    const normalizedSearch = String(search || "").trim().toLowerCase();
    const normalizedStatus = String(status || "").trim();
    let filtered = [...customers];
    if (normalizedStatus) {
      filtered = filtered.filter((customer) => customer.status === normalizedStatus);
    }
    if (normalizedSearch) {
      filtered = filtered.filter((customer) => {
        const haystack = [customer.name, customer.email, customer.phone]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }

    return filtered;
  }

  function normalizeCategorySlug(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  let categoriesReady;
  async function getBookCategories() {
    if (!categoriesReady) {
      categoriesReady = (async () => {
        const stored = await db.getCategories(defaultCategories);
        bookCategories = Array.isArray(stored) && stored.length
          ? stored.map((category) => ({
              id: String(category.id || category.slug || "").trim(),
              slug: normalizeCategorySlug(category.slug || category.id || category.value),
              name: sanitizePlainText(category.name || category.label || "", 120),
              label: sanitizePlainText(category.label || category.name || "", 120),
              status: ["active", "inactive"].includes(category.status) ? category.status : "active",
              description: sanitizePlainText(category.description || "", 500),
              createdAt: category.createdAt,
              updatedAt: category.updatedAt,
            })).filter((category) => category.slug)
          : defaultCategories.map((category) => ({ ...category }));
        allowedBookCategories.clear();
        for (const category of bookCategories) {
          if (category.status !== "inactive") allowedBookCategories.add(category.slug);
        }
        return bookCategories;
      })();
    }
    return categoriesReady;
  }

  async function saveBookCategories(categories) {
    bookCategories = categories;
    allowedBookCategories.clear();
    for (const category of bookCategories) {
      if (category.status !== "inactive") allowedBookCategories.add(category.slug);
    }
    await db.saveCategories(bookCategories);
    categoriesReady = Promise.resolve(bookCategories);
    return bookCategories;
  }

  function normalizeAuthorSlug(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  let authorsReady;
  async function getBookAuthors() {
    if (!authorsReady) {
      authorsReady = (async () => {
        const fallback = [];
        const names = [...new Set(books.map((book) => String(book.author || "").trim()).filter(Boolean))];
        for (const name of names) {
          fallback.push({
            id: normalizeAuthorSlug(name),
            slug: normalizeAuthorSlug(name),
            name,
            displayName: name,
            status: "active",
            bio: "",
          });
        }
        const stored = await db.getAuthors(fallback);
        if (Array.isArray(stored) && stored.length) {
          return stored.map((author) => {
            const name = sanitizePlainText(author.name || author.displayName || "", 200);
            const slug = normalizeAuthorSlug(author.slug || author.id || name);
            return {
              id: slug,
              slug,
              name,
              displayName: sanitizePlainText(author.displayName || name, 200),
              status: ["active", "inactive"].includes(author.status) ? author.status : "active",
              bio: sanitizePlainText(author.bio || "", 1000),
              createdAt: author.createdAt,
              updatedAt: author.updatedAt,
            };
          }).filter((author) => author.slug && author.name);
        }
        return fallback;
      })();
    }
    return authorsReady;
  }

  async function saveBookAuthors(authors) {
    await db.saveAuthors(authors);
    authorsReady = Promise.resolve(authors);
    return authors;
  }

  function normalizePublisherSlug(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  let publishersReady;
  async function getBookPublishers() {
    if (!publishersReady) {
      publishersReady = (async () => {
        const stored = await db.getPublishers([]);
        return (Array.isArray(stored) ? stored : []).map((publisher) => {
          const name = sanitizePlainText(publisher.name || publisher.displayName || "", 200);
          const slug = normalizePublisherSlug(publisher.slug || publisher.id || name);
          return {
            id: slug,
            slug,
            name,
            displayName: sanitizePlainText(publisher.displayName || name, 200),
            status: ["active", "inactive"].includes(publisher.status) ? publisher.status : "active",
            address: sanitizePlainText(publisher.address || "", 300),
            website: sanitizePlainText(publisher.website || "", 500),
            createdAt: publisher.createdAt,
            updatedAt: publisher.updatedAt,
          };
        }).filter((publisher) => publisher.slug && publisher.name);
      })();
    }
    return publishersReady;
  }

  async function saveBookPublishers(publishers) {
    await db.savePublishers(publishers);
    publishersReady = Promise.resolve(publishers);
    return publishers;
  }

  async function assertUniqueBookTitle(title, excludedId) {
    await waitForCatalogReady();
    const normalizedTitle = title.toLocaleLowerCase("vi");
    const duplicate = [...bookCatalog.values()].find(
      (book) =>
        book.id !== excludedId &&
        String(book.title || "").toLocaleLowerCase("vi") === normalizedTitle,
    );
    if (duplicate) {
      throw new RequestError(409, "Tên sách đã tồn tại trong danh mục.");
    }
  }

  async function assertStockCoversReservations(title, stock) {
    const orders = await db.getAllOrders(ordersPath);
    const reserved = orders
      .filter((order) => order.status !== "cancelled")
      .reduce(
        (total, order) =>
          total +
          (order.items || [])
            .filter((item) => item.title === title)
            .reduce((quantity, item) => quantity + Number(item.quantity || 0), 0),
        0,
      );
    if (stock < reserved) {
      throw new RequestError(409, "Tồn kho không thể thấp hơn số sách đã được đặt trước.");
    }
  }

  async function getCatalogBookList() {
    await waitForCatalogReady();
    const [custom, overrides] = await Promise.all([
      db.getCustomBooks(),
      typeof db.getCatalogBookOverrides === "function"
        ? db.getCatalogBookOverrides()
        : Promise.resolve([]),
    ]);
    const refreshedCatalog = new Map();
    const refreshedOverrides = new Map();
    const overridesById = new Map(overrides.map((book) => [book.id, book]));
    const allAuthors = await getBookAuthors();
    const allPublishers = await getBookPublishers();
    const enrichAuthorLinks = (book) => {
      const names = Array.isArray(book.authors)
        ? book.authors
        : String(book.author || "").split(/\s*[,;&]\s*|(?:\svà\s)/i).map((name) => name.trim()).filter(Boolean);
      const authorIds = Array.isArray(book.authorIds) && book.authorIds.length
        ? book.authorIds
        : names.map((name) => allAuthors.find((author) =>
            author.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
          )?.slug).filter(Boolean);
      const publisher = allPublishers.find((entry) =>
        entry.slug === book.publisherId ||
        entry.name.toLocaleLowerCase("vi") === String(book.publisher || "").toLocaleLowerCase("vi")
      );
      return {
        ...book,
        author: names.join(", ") || book.author || "",
        authors: names,
        authorIds,
        publisherId: publisher?.slug || book.publisherId || "",
        publisher: publisher?.displayName || publisher?.name || book.publisher || "",
      };
    };
    const baseBooks = books.map((book) => {
      const id = catalogBookId(book);
      const override = overridesById.get(id);
      const current = enrichAuthorLinks({
        ...book,
        stock: defaultBookStock,
        ...override,
        id,
        isCustom: false,
      });
      if (override) refreshedOverrides.set(id, override);
      refreshedCatalog.set(current.title, current);
      return current;
    });
    const customBooks = custom.map((book) => enrichAuthorLinks({ ...book, isCustom: true }));
    for (const book of customBooks) {
      if (book.title) refreshedCatalog.set(book.title, book);
    }
    bookCatalog = refreshedCatalog;
    catalogBookOverrides = refreshedOverrides;
    return [...baseBooks, ...customBooks];
  }

  const requestLimitOverrides = {
    ...(requestBodyLimits && typeof requestBodyLimits === "object" ? requestBodyLimits : {}),
    ...(Number.isSafeInteger(uploadMaxBytes) && uploadMaxBytes > 0 ? { upload: uploadMaxBytes } : {}),
  };
  const readRequestRawBody = (request, maxBytes) => readRawBody(request, maxBytes, requestLimitOverrides);
  const readRequestJson = (request, maxBytes) => readJson(request, maxBytes, requestLimitOverrides);

  const handlePublicRoute = createPublicRoutes({
    db,
    getCatalogBookList,
    getBookCategories,
    getBookAuthors,
    getBookPublishers,
    logRequestError,
    paginateBookList: (records, filters) => paginateList(records, filters, "title"),
    sendJson,
    sendPaginatedJson,
    uploadsDir,
    validateBookQuery: (requestUrl) => validateQuery(
      requestUrl,
      {
        ...listQuerySchema,
        sort: { type: "string", maxLength: 32, values: ["title", "price", "category"] },
      },
      "Bộ lọc sách không hợp lệ.",
    ),
  });
  const handlePaymentRoute = createPaymentRoutes({
    RequestError,
    db,
    monitoringMetrics,
    ordersPath,
    paymentWebhookSecret,
    publicOrder,
    readRawBody: readRequestRawBody,
    sepayConfig: sepayConfiguration,
    sendJson,
  });
  const addressStore = new AddressStore(addressesPath);
  const handleAddressRoute = createAddressRoutes({
    RequestError,
    addressStore,
    getAuthUser,
    payloadSchemas,
    readJson: readRequestJson,
    requireJsonObject,
    sanitizePlainText,
    sendJson,
    validateQuery,
  });
  const handleOrderRoute = createOrderRoutes({
    RequestError,
    ROLES,
    addressStore,
    allowedDiscountRates,
    allowedOrderStatuses,
    allowedPaymentStatuses,
    createAndPersistOrder,
    createOrder,
    createUpdatedOrderItems,
    db,
    defaultBookStock,
    enqueueOrderWrite,
    getAuthUser,
    getBookCatalog: () => bookCatalog,
    verifyOrderAccessCode,
    listQuerySchema,
    ordersPath,
    orderRequestLimit,
    orderRequestWindowMs,
    paginateList,
    payloadSchemas,
    publicOrder,
    randomUUID,
    rateLimitRequest,
    getClientAddress: getRequestClientAddress,
    readJson: readRequestJson,
    requireJsonObject,
    roundMoney,
    sanitizePlainText,
    sendJson,
    sendPaginatedJson,
    validateQuery,
    waitForCatalogReady,
  });
  const handleAuthRoute = createAuthRoutes({
    RequestError,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    ROLES,
    appBaseUrl,
    auditLogPath,
    db,
    dispatchMonitoringAlert,
    getAuthUser,
    hashPasswordResetToken,
    isPasswordValid,
    loginAttemptLimit,
    loginAttemptWindowMs,
    loginAccountAttemptLimit,
    loginAccountWindowMs,
    passwordResetIpLimit,
    passwordResetEmailLimit,
    passwordResetWindowMs,
    passwordResetTtlMs,
    emailVerificationTtlMs,
    passwordResetMailer,
    payloadSchemas,
    privacyExportStore,
    publicUser,
    rateLimitRequest,
    clearRateLimit,
    getClientAddress: getRequestClientAddress,
    randomBytes,
    readJson: readRequestJson,
    registrationAttemptLimit,
    registrationAttemptWindowMs,
    requireJsonObject,
    sanitizePlainText,
    sendJson,
    sessionStore,
    socialTokenVerifier,
    verifyPassword,
    verifyPasswordReauthentication,
    verifySocialIdentity,
  });
  const handlePrivacyRoute = createPrivacyRoutes({
    RequestError,
    addressStore,
    allowedConsentPurposes,
    allowedConsentSources,
    allowedPrivacyDataRequestStatuses: privacyDataRequestStatuses,
    allowedPrivacyDataRequestTypes: privacyDataRequestTypes,
    auditLogPath,
    db,
    getAuthUser,
    ordersPath,
    payloadSchemas,
    privacyExportStore,
    rateLimitRequest,
    readJson: readRequestJson,
    requireAdmin,
    requireJsonObject,
    requireRole,
    sanitizePlainText,
    sendJson,
    sessionStore,
    verifyPasswordReauthentication,
  });
  const handleCustomerRoute = createCustomerRoutes({
    RequestError,
    applyCustomerFilters,
    customerInteractionQuerySchema,
    customerQuerySchema,
    db,
    paginateList,
    payloadSchemas,
    readJson: readRequestJson,
    requireCustomerPermission,
    requireJsonObject,
    sendJson,
    sendPaginatedJson,
    validateCustomerData,
    validateCustomerInteractionData,
    validateQuery,
  });
  const handleServiceRoute = createServiceRoutes({
    RequestError,
    allowedServiceStatuses,
    allowedServiceTypes,
    db,
    getAuthUser,
    listQuerySchema,
    paginateList,
    payloadSchemas,
    readJson: readRequestJson,
    requireJsonObject,
    requireRole,
    sanitizePlainText,
    sendJson,
    sendPaginatedJson,
    validateQuery,
  });
  const handleAdminRoute = createAdminRoutes({
    CUSTOMER_ROLE_PERMISSIONS,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    ROLE_PERMISSIONS,
    ROLES,
    RequestError,
    STUDENT_VERIFICATION_STATUSES,
    allowedOrderStatuses,
    allowedPaymentStatuses,
    allowedServiceStatuses,
    assertStockCoversReservations,
    assertUniqueBookTitle,
    auditLogPath,
    backupStatusFile,
    bookCount: books.length,
    catalogBookById,
    db,
    enqueueOrderWrite,
    getBookCatalog: () => bookCatalog,
    getCatalogBookOverrides: () => catalogBookOverrides,
    getCatalogBookList,
    getDatabaseMonitoringStatus,
    getBookAuthors,
    getBookPublishers,
    getBookCategories,
    isPasswordValid,
    listQuerySchema,
    monitoringMetrics,
    normalizeAdminBook,
    normalizePublisherSlug,
    normalizeAuthorSlug,
    normalizeCategorySlug,
    normalizeCoupon,
    ordersPath,
    paginateList,
    payloadSchemas,
    privacyExportStore,
    publicUser,
    readAuditEntries,
    readBackupStatus,
    readJson: readRequestJson,
    readRawBody: readRequestRawBody,
    requireJsonObject,
    requireRole,
    sanitizePlainText,
    sendJson,
    sendPaginatedJson,
    saveBookAuthors,
    saveBookPublishers,
    saveBookCategories,
    sessionStore,
    startedAt,
    uploadMaxBytes,
    uploadsDir,
    validateQuery,
    waitForCatalogReady,
  });

  async function handleRequest(request, response) {
    if (typeof request.url === "string" && request.url.length > MAX_URL_LENGTH) {
      throw new RequestLimitError(414, "Đường dẫn yêu cầu quá dài.", {
        errorCode: "URI_TOO_LONG",
        maxBytes: MAX_URL_LENGTH,
      });
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url, "http://localhost");
    } catch {
      throw new RequestError(400, "Đường dẫn yêu cầu không hợp lệ.");
    }
    validateApiPath(requestUrl.pathname);
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-API-Version, Deprecation, Sunset, Link, Idempotency-Key, Idempotency-Replayed");
    }

    if (request.method === "OPTIONS") {
      response.writeHead(origin && !allowedOrigins.has(origin) ? 403 : 204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, If-Match, X-Request-Id, X-Order-Access-Code, X-Export-Token, X-File-Name, X-CSRF-Token",
      });
      response.end();
      return;
    }

    const versionInfo = resolveApiVersion(requestUrl.pathname);
    if (versionInfo.isApi) {
      applyApiVersionHeaders(response, versionInfo);
      if (versionInfo.unsupportedVersion) {
        const versionError = new RequestError(
          404,
          `Phiên bản API "${versionInfo.unsupportedVersion}" không được hỗ trợ. Phiên bản hiện hành: ${SUPPORTED_API_VERSIONS.join(", ")}.`,
        );
        versionError.errorCode = "UNSUPPORTED_API_VERSION";
        throw versionError;
      }
      requestUrl.pathname = versionInfo.canonicalPath;
    }

    const csrfCheck = validateCsrfRequest(request, requestUrl.pathname, allowedOrigins);
    if (!csrfCheck.ok) {
      const csrfError = new RequestError(403, csrfCheck.message);
      csrfError.errorCode = csrfCheck.errorCode;
      throw csrfError;
    }

    assertRequestSizeHeaders(request, requestUrl.pathname, requestLimitOverrides);

    await auditSensitiveRequest(request, response, requestUrl);
    if (await handlePublicRoute(request, response, requestUrl)) return;
    if (await handlePaymentRoute(request, response, requestUrl.pathname)) return;
    if (await handleAuthRoute(request, response, requestUrl)) return;
    if (await handleAddressRoute(request, response, requestUrl)) return;
    if (await handlePrivacyRoute(request, response, requestUrl)) return;
    if (await handleCustomerRoute(request, response, requestUrl)) return;
    if (await handleServiceRoute(request, response, requestUrl)) return;
    if (await handleOrderRoute(request, response, requestUrl)) return;
    if (await handleAdminRoute(request, response, requestUrl)) return;

    if (
      requestUrl.pathname === "/api/admin" ||
      requestUrl.pathname.startsWith("/api/admin/")
    ) {
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để truy cập API quản trị.");
      }
      const permission = getAdminPermission(requestUrl.pathname, request.method);
      if (!permission) {
        throw new RequestError(403, "API quản trị không tồn tại hoặc bạn không có quyền truy cập.");
      }
      if (!hasPermission(requester, permission)) {
        throw new RequestError(403, "Bạn không có quyền truy cập API quản trị.");
      }
      throw new RequestError(404, "Không tìm thấy API quản trị.");
    }

    // Catch unhandled /api/ requests
    if (requestUrl.pathname.startsWith("/api/")) {
      const { payload } = buildApiErrorPayload({
        error: new RequestError(404, "Không tìm thấy API."),
        status: 404,
        isExpectedError: true,
        requestId: response.getHeader("X-Request-Id"),
      });
      sendJson(response, 404, payload);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    await serveStatic(request, response, requestUrl.pathname, staticRoot);
  }

  const server = http.createServer((request, response) => {
    const requestId = getRequestId(request);
    const requestStartedAt = process.hrtime.bigint();
    response.setHeader("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(securityHeaders)) {
      response.setHeader(name, value);
    }
    const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (
      request.socket?.encrypted === true ||
      (String(process.env.NODE_ENV || "").toLowerCase() === "production" &&
        forwardedProto === "https")
    ) {
      response.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    response.once("finish", () => {
      let pathname = "/";
      try {
        pathname = new URL(request.url, "http://localhost").pathname;
      } catch {
        pathname = "<invalid-url>";
      }
      const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1e6;
      const sample = monitoringMetrics.recordRequest({
        method: request.method,
        pathname,
        status: response.statusCode,
        durationMs,
      });
      const record = {
        timestamp: new Date().toISOString(),
        level: response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info",
        event: "http_request",
        requestId: redactLogText(requestId),
        method: sample.method,
        route: sample.route,
        status: sample.status,
        durationMs: Number(durationMs.toFixed(2)),
      };
      const serialized = JSON.stringify(record);
      if (response.statusCode >= 500) console.error(serialized);
      else if (response.statusCode >= 400) console.warn(serialized);
      else console.log(serialized);
      for (const alert of monitoringMetrics.getTriggeredAlerts()) {
        dispatchMonitoringAlert(alert, requestId);
      }
    });
    void withAuditRequestContext(requestId, () => handleRequest(request, response)).catch(async (error) => {
      const isExpectedError =
        error instanceof RequestError ||
        error instanceof RequestLimitError ||
        error instanceof ValidationError ||
        error instanceof CustomerError;
      const status =
        isExpectedError &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599
          ? error.status
          : 500;
      await auditAdminRequestFailure(request, requestId, status);
      if (status >= 500) {
        logRequestError(
          request,
          requestId,
          error,
          "Request failed",
        );
      }
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (status === 413 && !request.complete) {
        response.setHeader("Connection", "close");
      }
      const isApiRequest = (() => {
        if (typeof request.url === "string" && request.url.startsWith("/api/")) {
          return true;
        }
        try {
          return new URL(request.url, "http://localhost").pathname.startsWith("/api/");
        } catch {
          return false;
        }
      })();
      if (isApiRequest) {
        const { status: effectiveStatus, payload } = buildApiErrorPayload({
          error,
          status,
          isExpectedError,
          requestId,
        });
        sendJson(response, effectiveStatus, payload);
        return;
      }
      void sendHtmlError(response, status, status === 404 ? "404" : "500");
    });
  });
  server.once("close", () => {
    sessionStore.close();
    privacyExportStore.close();
    if (typeof db.close !== "function") return;
    try {
      Promise.resolve(db.close()).catch((error) => {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "database_pool_close_failed",
          errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
          message: redactLogText(error instanceof Error ? error.message : String(error)),
        }));
        process.exitCode = 1;
      });
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "database_pool_close_failed",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
        message: redactLogText(error instanceof Error ? error.message : String(error)),
      }));
      process.exitCode = 1;
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
  const server = createServer();
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Nhận ${signal}, đang dừng server an toàn.`);
    server.close((error) => {
      if (!error) return;
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "server_shutdown_failed",
        message: redactLogText(error.message),
      }));
      process.exitCode = 1;
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  server.listen(port, host, () => {
    console.log(`BookNest đang chạy tại http://${host}:${port}`);
  });
}

module.exports = { createServer };
