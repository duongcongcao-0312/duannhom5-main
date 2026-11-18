const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  createHash,
  randomBytes,
  randomUUID,
} = require("node:crypto");
const books = require("../books-data");
const {
  CustomerError,
  Database,
  SOCIAL_PROVIDERS,
  validateCustomerInteractionData,
  validateCustomerData,
} = require("./db");
const { PostgresDatabase } = require("./postgres-db");
const { normalizeSePayConfig } = require("./sepay-config");
const { readAuditEntries } = require("./audit");
const { hashOrderRequest } = require("./order-idempotency");
const { getAdminPermission } = require("./router");
const {
  hashPasswordResetToken,
  isPasswordValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_REFRESH_TTL_MS,
  SESSION_TTL_MS,
  SessionStore,
  verifyPassword,
} = require("./auth");
const { createEmailMailer } = require("./email");
const { getCouponUnavailableReason } = require("./coupons");
const { createPaymentRoutes } = require("./routes/payments");
const { createPublicRoutes } = require("./routes/public");
const { createOrderRoutes } = require("./routes/orders");
const { createAuthRoutes } = require("./routes/auth");
const { createPrivacyRoutes } = require("./routes/privacy");
const { createCustomerRoutes } = require("./routes/customers");
const { createServiceRoutes } = require("./routes/services");
const { createAdminRoutes } = require("./routes/admin");
const { createFirebaseIdTokenVerifier } = require("./firebase-auth");
const {
  CUSTOMER_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  requireCustomerPermission: requireCustomerPermissionMiddleware,
  requireRole: requireRoleMiddleware,
} = require("./authorization");
const {
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  STUDENT_VERIFICATION_STATUSES,
} = require("./business-constants");

const root = path.resolve(__dirname, "..");
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
  "privacy.html",
  "robots.txt",
  "sitemap.xml",
  "terms.html",
]);
const catalogBookId = (book) =>
  `catalog-${createHash("sha256").update(book.title).digest("hex")}`;
const catalogBookById = new Map(
  books.map((book) => [catalogBookId(book), book]),
);
const defaultBookStock = 12;
let bookCatalog = new Map(
  books.map((book) => [
    book.title,
    { ...book, id: catalogBookId(book), stock: book.stock ?? defaultBookStock, isCustom: false },
  ]),
);
let catalogBookOverrides = new Map();
const allowedBookCategories = new Set(books.map((book) => book.category));
const allowedDiscountRates = new Set([0, 0.05, 0.1]);
const allowedServiceTypes = new Set(Object.values(SERVICE_TYPES));
const allowedOrderStatuses = new Set(Object.values(ORDER_STATUSES));
const allowedPaymentStatuses = new Set(Object.values(PAYMENT_STATUSES));
const allowedConsentPurposes = new Set(["order", "service", "marketing"]);
const allowedConsentSources = new Set(["web", "admin", "api"]);
const allowedPrivacyDataRequestTypes = new Set(["access", "update", "delete"]);
const allowedPrivacyDataRequestStatuses = new Set(["in_review", "completed", "rejected"]);
const currentPrivacyPolicyVersion = "2026-01";
const payloadSchemas = {
  passwordReset: {
    allowed: ["email"],
    required: ["email"],
    types: { email: "string" },
  },
  passwordResetConfirm: {
    allowed: ["token", "password"],
    required: ["token", "password"],
    types: { token: "string", password: "string" },
    preserveStrings: ["password"],
  },
  register: {
    allowed: ["name", "email", "password", "studentType", "studentId"],
    required: ["name", "email", "password"],
    types: {
      name: "string",
      email: "string",
      password: "string",
      studentType: "string",
      studentId: "string",
    },
    preserveStrings: ["password"],
  },
  login: {
    allowed: ["email", "password"],
    required: ["email", "password"],
    types: { email: "string", password: "string" },
    preserveStrings: ["password"],
  },
  staff: {
    allowed: ["name", "email", "password", "role"],
    required: ["name", "email", "password", "role"],
    types: { name: "string", email: "string", password: "string", role: "string" },
    preserveStrings: ["password"],
  },
  staffUpdate: {
    allowed: ["name", "email", "role", "isActive"],
    types: { name: "string", email: "string", role: "string", isActive: "boolean" },
    minProperties: 1,
  },
  socialAuth: {
    allowed: [
      "name",
      "email",
      "provider",
      "providerId",
      "firebaseUid",
      "studentType",
      "studentId",
    ],
    required: ["email"],
    types: {
      name: "string",
      email: "string",
      provider: "string",
      providerId: "string",
      firebaseUid: "string",
      studentType: "string",
      studentId: "string",
    },
  },
  socialAuthLink: {
    allowed: ["idToken", "password"],
    required: ["idToken", "password"],
    types: { idToken: "string", password: "string" },
    preserveStrings: ["idToken", "password"],
  },
  socialAuthUnlink: {
    allowed: ["provider", "password"],
    required: ["provider", "password"],
    types: { provider: "string", password: "string" },
    preserveStrings: ["password"],
  },
  customerInfo: {
    allowed: ["customerName", "name", "phone", "address"],
    types: {
      customerName: "string",
      name: "string",
      phone: "string",
      address: "string",
    },
    minProperties: 1,
  },
  customerInteraction: {
    allowed: ["type", "note"],
    required: ["type", "note"],
    types: { type: "string", note: "string" },
    preserveStrings: ["note"],
  },
  customerInteractionUpdate: {
    allowed: ["type", "note"],
    types: { type: "string", note: "string" },
    minProperties: 1,
    preserveStrings: ["note"],
  },
  customer: {
    allowed: ["name", "email", "phone"],
    required: ["name", "email", "phone"],
    types: { name: "string", email: "string", phone: "string" },
  },
  customerUpdate: {
    allowed: ["name", "email", "phone", "status"],
    types: {
      name: "string",
      email: "string",
      phone: "string",
      status: "string",
    },
    minProperties: 1,
  },
  order: {
    allowed: [
      "customerName",
      "address",
      "phone",
      "paymentMethod",
      "discountRate",
      "couponCode",
      "subtotal",
      "discount",
      "total",
      "items",
    ],
    required: [
      "customerName",
      "address",
      "phone",
      "paymentMethod",
      "items",
    ],
    types: {
      customerName: "string",
      address: "string",
      phone: "string",
      paymentMethod: "string",
      discountRate: "number",
      couponCode: "string",
      subtotal: "number",
      discount: "number",
      total: "number",
      items: "array",
    },
  },
  orderQuote: {
    allowed: ["discountRate", "couponCode", "items"],
    required: ["items"],
    types: {
      discountRate: "number",
      couponCode: "string",
      items: "array",
    },
    coupon: {
      allowed: [
        "code",
        "label",
        "rate",
        "minSubtotal",
        "maxUses",
        "startsAt",
        "expiresAt",
        "enabled",
      ],
      required: [
        "code",
        "label",
        "rate",
        "minSubtotal",
        "maxUses",
        "startsAt",
        "expiresAt",
        "enabled",
      ],
      types: {
        code: "string",
        label: "string",
        rate: "number",
        minSubtotal: "number",
        maxUses: "number",
        startsAt: "string",
        expiresAt: "string",
        enabled: "boolean",
      },
    },
    couponUpdate: {
      allowed: [
        "label",
        "rate",
        "minSubtotal",
        "maxUses",
        "startsAt",
        "expiresAt",
        "enabled",
      ],
      required: [
        "label",
        "rate",
        "minSubtotal",
        "maxUses",
        "startsAt",
        "expiresAt",
        "enabled",
      ],
      types: {
        label: "string",
        rate: "number",
        minSubtotal: "number",
        maxUses: "number",
        startsAt: "string",
        expiresAt: "string",
        enabled: "boolean",
      },
    },
    couponToggle: {
      allowed: ["enabled"],
      required: ["enabled"],
      types: { enabled: "boolean" },
    },
  },
  orderUpdate: {
    allowed: ["status", "paymentStatus", "items"],
    types: { status: "string", paymentStatus: "string", items: "array" },
    minProperties: 1,
  },
  orderStatusUpdate: {
    allowed: ["status", "paymentStatus"],
    types: { status: "string", paymentStatus: "string" },
    minProperties: 1,
  },
  service: {
    allowed: ["bookTitle", "name", "phone", "service", "condition", "note"],
    required: ["bookTitle", "name", "phone", "service"],
    types: {
      bookTitle: "string",
      name: "string",
      phone: "string",
      service: "string",
      condition: "string",
      note: "string",
    },
  },
  serviceStatus: {
    allowed: ["status"],
    required: ["status"],
    types: { status: "string" },
  },
  privacyDataRequest: {
    allowed: ["type"],
    required: ["type"],
    types: { type: "string" },
  },
  privacyDataRequestStatus: {
    allowed: ["status"],
    required: ["status"],
    types: { status: "string" },
  },
  book: {
    allowed: [
      "title",
      "author",
      "category",
      "price",
      "stock",
      "cover",
      "description",
    ],
    required: ["title", "author", "price"],
    types: {
      title: "string",
      author: "string",
      category: "string",
      price: "number",
      stock: "number",
      cover: "string",
      description: "string",
    },
  },
  bookUpdate: {
    allowed: [
      "title",
      "author",
      "category",
      "price",
      "stock",
      "cover",
      "description",
    ],
    types: {
      title: "string",
      author: "string",
      category: "string",
      price: "number",
      stock: "number",
      cover: "string",
      description: "string",
    },
    minProperties: 1,
  },
};
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
const maxRequestBytes = 1024 * 1024;
class RequestError extends Error {
  constructor(status, message, cause) {
    super(message);
    this.status = status;
    this.cause = cause;
  }
}

function getRequestId(request) {
  const suppliedId = request.headers["x-request-id"];
  return typeof suppliedId === "string" &&
    suppliedId.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(suppliedId)
    ? suppliedId
    : randomUUID();
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
  console.error(JSON.stringify({
    level: "error",
    message,
    requestId,
    method: request.method,
    path: pathname,
    error: {
      name: loggedError instanceof Error ? loggedError.name : "UnknownError",
      message: loggedError instanceof Error ? loggedError.message : String(loggedError),
      stack: loggedError instanceof Error ? loggedError.stack : undefined,
    },
  }));
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

async function readJson(request) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestError(415, "Yêu cầu phải gửi ở định dạng JSON.");
  }

  const rawBody = await readRawBody(request);
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new RequestError(400, "Dữ liệu yêu cầu không hợp lệ.");
  }
  return payload;
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new RequestError(413, "Yêu cầu quá lớn.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

function normalizeAdminBook(payload, existing) {
  const title = payload.title === undefined
    ? existing?.title
    : sanitizePlainText(payload.title, 200);
  const author = payload.author === undefined
    ? existing?.author
    : sanitizePlainText(payload.author, 200);
  const category = payload.category === undefined
    ? existing?.category
    : sanitizePlainText(payload.category, 64);
  const price = payload.price === undefined ? existing?.price : payload.price;
  const stock = payload.stock === undefined ? existing?.stock : payload.stock;

  if (!title || !author) {
    throw new RequestError(400, "Vui lòng nhập tên sách và tác giả.");
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

  return {
    title,
    author,
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError(400, message);
  }

  const sanitized = sanitizePayload(payload);
  for (const field of schema?.preserveStrings || []) {
    if (typeof payload[field] === "string") {
      sanitized[field] = payload[field];
    }
  }
  const prototype = Object.getPrototypeOf(sanitized);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RequestError(400, message);
  }

  if (schema) {
    const allowedFields = new Set(schema.allowed);
    if (Object.keys(sanitized).some((field) => !allowedFields.has(field))) {
      throw new RequestError(400, message);
    }
    if (schema.required?.some((field) => !Object.hasOwn(sanitized, field))) {
      throw new RequestError(400, message);
    }
    if (
      Number.isInteger(schema.minProperties) &&
      Object.keys(sanitized).length < schema.minProperties
    ) {
      throw new RequestError(400, message);
    }
    for (const [field, type] of Object.entries(schema.types || {})) {
      if (
        Object.hasOwn(sanitized, field) &&
        (type === "array"
          ? !Array.isArray(sanitized[field])
          : typeof sanitized[field] !== type)
      ) {
        throw new RequestError(400, message);
      }
    }
  }

  return sanitized;
}

function validateQuery(requestUrl, schema, message) {
  const values = {};
  for (const [field, value] of requestUrl.searchParams) {
    const definition = schema[field];
    if (!definition || Object.hasOwn(values, field) || value.length > definition.maxLength) {
      throw new RequestError(400, message);
    }

    if (definition.type === "integer") {
      if (!/^\d+$/.test(value)) throw new RequestError(400, message);
      const number = Number(value);
      if (
        !Number.isSafeInteger(number) ||
        number < definition.min ||
        number > definition.max
      ) {
        throw new RequestError(400, message);
      }
      values[field] = number;
      continue;
    }
    if (definition.values && !definition.values.includes(value)) {
      throw new RequestError(400, message);
    }
    values[field] = value;
  }
  return values;
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
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RequestError(400, "Số lượng sách phải là số nguyên lớn hơn 0.");
    }
    if (item.quantity > stock) {
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
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new RequestError(400, "Số lượng sách phải là số nguyên lớn hơn 0.");
    }
    const quantity = (quantities.get(book.title) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw new RequestError(400, "Số lượng sách không hợp lệ.");
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

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": contents.length,
    "Content-Type":
      mimeTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
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
  couponsPath,
  customerInteractionsPath,
  consentRecordsPath,
  auditLogPath = path.join(root, "data", "admin-audit.jsonl"),
  database,
  paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "",
  sepayApiKey = process.env.SEPAY_API_KEY || "",
  sepayBankCode = process.env.SEPAY_BANK_CODE || "",
  sepayBankName = process.env.SEPAY_BANK_NAME || "",
  sepayAccountNumber = process.env.SEPAY_ACCOUNT_NUMBER || "",
  sepayAccountName = process.env.SEPAY_ACCOUNT_NAME || "",
  sessionTtlMs = Number.isFinite(Number(process.env.SESSION_TTL_MS))
    ? Number(process.env.SESSION_TTL_MS)
    : SESSION_TTL_MS,
  refreshTtlMs = Number.isFinite(Number(process.env.SESSION_REFRESH_TTL_MS))
    ? Number(process.env.SESSION_REFRESH_TTL_MS)
    : SESSION_REFRESH_TTL_MS,
  passwordResetMailer = createEmailMailer(),
  socialTokenVerifier = createFirebaseIdTokenVerifier(),
  appBaseUrl = process.env.PUBLIC_APP_URL,
  corsOrigins = process.env.CORS_ORIGINS || (
    process.env.RENDER
      ? "https://duongcongcao-0312.github.io"
      : "http://127.0.0.1:8000,http://localhost:8000"
  ),
} = {}) {
  const sepayConfig = normalizeSePayConfig({
    apiKey: sepayApiKey,
    bankCode: sepayBankCode,
    bankName: sepayBankName,
    accountNumber: sepayAccountNumber,
    accountName: sepayAccountName,
  });
  if (process.env.NODE_ENV === "production") {
    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim();
    const adminPassword = String(process.env.ADMIN_PASSWORD || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminPassword.length < 12) {
      throw new Error(
        "Production requires a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.",
      );
    }
  }

  if (process.env.RENDER && !database && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL phải được cấu hình trên Render trước khi chạy backend.");
  }

  let persistenceQueue = Promise.resolve();
  const db = database || (process.env.DATABASE_URL
    ? new PostgresDatabase()
    : new Database({
      root,
      ordersPath,
      usersPath,
      customersPath,
      servicesPath,
      booksPath,
      couponsPath,
      customerInteractionsPath,
      consentRecordsPath,
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
  const sessionStore = new SessionStore({
    repository: sessionRepository,
    sessionTtlMs,
    refreshTtlMs,
    cleanupIntervalMs: 60 * 1000,
  });
  const loginAttempts = new Map();
  const reauthenticationAttempts = new Map();
  const loginAttemptLimit = 5;
  const loginAttemptWindowMs = 15 * 60 * 1000;
  const registrationAttempts = new Map();
  const registrationAttemptLimit = 5;
  const registrationAttemptWindowMs = 15 * 60 * 1000;
  const passwordResetAttempts = new Map();
  const passwordResetEmailAttempts = new Map();
  function verifyPasswordReauthentication(request, user, password) {
    const now = Date.now();
    for (const [address, attempt] of reauthenticationAttempts) {
      if (attempt.expiresAt <= now) reauthenticationAttempts.delete(address);
    }
    const address = request.socket.remoteAddress || "unknown";
    const attempt = reauthenticationAttempts.get(address);
    if (attempt && attempt.count >= loginAttemptLimit) {
      throw new RequestError(
        429,
        "Bạn đã thử xác thực lại quá nhiều lần. Vui lòng thử lại sau 15 phút.",
      );
    }
    if (
      user.passwordAuthEnabled === false ||
      !verifyPassword(password, user.password)
    ) {
      reauthenticationAttempts.set(address, {
        count: (attempt?.count || 0) + 1,
        expiresAt: attempt?.expiresAt || now + loginAttemptWindowMs,
      });
      throw new RequestError(401, "Email hoặc mật khẩu không chính xác.");
    }
    reauthenticationAttempts.delete(address);
  }
  let orderWriteQueue = Promise.resolve();
  const allowedOrigins = new Set(
    corsOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  let catalogLoadError;
  let catalogLoadPromise = null;
  let catalogLoaded = false;
  let nextCatalogRetryAt = 0;
  const catalogRetryDelaysMs = [200, 600];
  const catalogRetryCooldownMs = 2_000;

  async function loadCatalogWithRetries() {
    let lastError;
    for (let attempt = 0; attempt <= catalogRetryDelaysMs.length; attempt += 1) {
      try {
        const [custom, overrides] = await Promise.all([
          db.getCustomBooks(),
          typeof db.getCatalogBookOverrides === "function"
            ? db.getCatalogBookOverrides()
            : Promise.resolve([]),
        ]);
        for (const override of overrides) {
          const baseBook = catalogBookById.get(override.id);
          if (!baseBook) continue;
          if (override.title !== baseBook.title) bookCatalog.delete(baseBook.title);
          catalogBookOverrides.set(override.id, override);
          bookCatalog.set(override.title, {
            ...baseBook,
            ...override,
            isCustom: false,
          });
        }
        for (const book of custom) {
          if (book && book.title) {
            bookCatalog.set(book.title, { ...book, isCustom: true });
          }
        }
        catalogLoaded = true;
        catalogLoadError = null;
        nextCatalogRetryAt = 0;
        return;
      } catch (error) {
        lastError = error;
        if (attempt < catalogRetryDelaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, catalogRetryDelaysMs[attempt]));
        }
      }
    }
    throw lastError;
  }

  function startCatalogLoad() {
    if (catalogLoaded) return Promise.resolve();
    if (catalogLoadPromise) return catalogLoadPromise;
    catalogLoadPromise = (async () => {
      try {
        await loadCatalogWithRetries();
      } catch (error) {
        catalogLoadError = error;
        nextCatalogRetryAt = Date.now() + catalogRetryCooldownMs;
        console.error("Catalog load failed:", error);
      } finally {
        catalogLoadPromise = null;
      }
    })();
    return catalogLoadPromise;
  }

  void startCatalogLoad();

  async function waitForCatalogReady() {
    if (!catalogLoadPromise && catalogLoadError && Date.now() < nextCatalogRetryAt) {
      throw catalogLoadError;
    }
    await startCatalogLoad();
    if (catalogLoadError) throw catalogLoadError;
  }
  async function createAndPersistOrder(payload, userId, requester, idempotencyKey) {
    await waitForCatalogReady();
    const operation = orderWriteQueue.then(async () => {
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
        const replayHash = hashOrderRequest(replayOrder);
        if (existingOrder.idempotencyHash && existingOrder.idempotencyHash !== replayHash) {
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
    orderWriteQueue = operation.catch(() => {});
    return operation;
  }

  async function getAuthUser(request) {
    const authHeader = request.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    return await sessionStore.getSession(token);
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
    const baseBooks = books.map((book) => {
      const id = catalogBookId(book);
      const override = overridesById.get(id);
      const current = {
        ...book,
        stock: defaultBookStock,
        ...override,
        id,
        isCustom: false,
      };
      if (override) refreshedOverrides.set(id, override);
      refreshedCatalog.set(current.title, current);
      return current;
    });
    const customBooks = custom.map((book) => ({ ...book, isCustom: true }));
    for (const book of customBooks) {
      if (book.title) refreshedCatalog.set(book.title, book);
    }
    bookCatalog = refreshedCatalog;
    catalogBookOverrides = refreshedOverrides;
    return [...baseBooks, ...customBooks];
  }

  const handlePublicRoute = createPublicRoutes({
    db,
    getCatalogBookList,
    logRequestError,
    paginateBookList: (records, filters) => paginateList(records, filters, "title"),
    sendJson,
    sendPaginatedJson,
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
    ordersPath,
    paymentWebhookSecret,
    publicOrder,
    readRawBody,
    sepayConfig,
    sendJson,
  });
  const handleOrderRoute = createOrderRoutes({
    RequestError,
    ROLES,
    allowedDiscountRates,
    allowedOrderStatuses,
    allowedPaymentStatuses,
    createAndPersistOrder,
    createOrder,
    createUpdatedOrderItems,
    db,
    defaultBookStock,
    getAuthUser,
    getBookCatalog: () => bookCatalog,
    listQuerySchema,
    ordersPath,
    paginateList,
    payloadSchemas,
    publicOrder,
    randomUUID,
    readJson,
    requireJsonObject,
    roundMoney,
    sanitizePlainText,
    sendJson,
    sendPaginatedJson,
    validateQuery,
  });
  const handleAuthRoute = createAuthRoutes({
    RequestError,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    ROLES,
    appBaseUrl,
    db,
    getAuthUser,
    hashPasswordResetToken,
    isPasswordValid,
    loginAttempts,
    loginAttemptLimit,
    loginAttemptWindowMs,
    passwordResetAttempts,
    passwordResetEmailAttempts,
    passwordResetMailer,
    payloadSchemas,
    publicUser,
    randomBytes,
    readJson,
    registrationAttempts,
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
    allowedConsentPurposes,
    allowedConsentSources,
    allowedPrivacyDataRequestStatuses,
    allowedPrivacyDataRequestTypes,
    db,
    getAuthUser,
    payloadSchemas,
    readJson,
    requireAdmin,
    requireJsonObject,
    sanitizePlainText,
    sendJson,
  });
  const handleCustomerRoute = createCustomerRoutes({
    RequestError,
    applyCustomerFilters,
    customerInteractionQuerySchema,
    customerQuerySchema,
    db,
    paginateList,
    payloadSchemas,
    readJson,
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
    currentPrivacyPolicyVersion,
    db,
    getAuthUser,
    listQuerySchema,
    paginateList,
    payloadSchemas,
    readJson,
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
    RequestError,
    STUDENT_VERIFICATION_STATUSES,
    allowedOrderStatuses,
    allowedPaymentStatuses,
    assertStockCoversReservations,
    assertUniqueBookTitle,
    auditLogPath,
    bookCount: books.length,
    catalogBookById,
    db,
    getBookCatalog: () => bookCatalog,
    getCatalogBookOverrides: () => catalogBookOverrides,
    getCatalogBookList,
    isPasswordValid,
    listQuerySchema,
    normalizeAdminBook,
    normalizeCoupon,
    ordersPath,
    paginateList,
    payloadSchemas,
    publicUser,
    readAuditEntries,
    readJson,
    requireJsonObject,
    requireRole,
    sanitizePlainText,
    sendJson,
    sendPaginatedJson,
    sessionStore,
    validateQuery,
    waitForCatalogReady,
  });

  async function handleRequest(request, response) {
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
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
    }

    if (request.method === "OPTIONS") {
      response.writeHead(origin && !allowedOrigins.has(origin) ? 403 : 204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, If-Match, X-Request-Id",
      });
      response.end();
      return;
    }

    if (await handlePublicRoute(request, response, requestUrl)) return;
    if (await handlePaymentRoute(request, response, requestUrl.pathname)) return;
    if (await handleAuthRoute(request, response, requestUrl)) return;
    if (await handlePrivacyRoute(request, response, requestUrl)) return;
    if (await handleCustomerRoute(request, response, requestUrl)) return;
    if (await handleServiceRoute(request, response, requestUrl)) return;

    if (await handleOrderRoute(request, response, requestUrl)) return;
    if (await handleAdminRoute(request, response, requestUrl)) return;

    if (requestUrl.pathname.startsWith("/api/admin/")) {
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
      sendJson(response, 404, { error: "Không tìm thấy API." });
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
    response.setHeader("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(securityHeaders)) {
      response.setHeader(name, value);
    }
    void handleRequest(request, response).catch((error) => {
      const isExpectedError =
        error instanceof RequestError || error instanceof CustomerError;
      const status =
        isExpectedError &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599
          ? error.status
          : 500;
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
        const message =
          (status < 500 || error instanceof RequestError) && isExpectedError
            ? error.message
            : "Máy chủ gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.";
        sendJson(response, status, { error: message });
        return;
      }
      void sendHtmlError(response, status, status === 404 ? "404" : "500");
    });
  });
  server.once("close", () => {
    sessionStore.close();
    if (typeof db.close !== "function") return;
    try {
      Promise.resolve(db.close()).catch((error) => {
        console.error(JSON.stringify({
          level: "error",
          message: "Failed to close the database pool",
          error: error instanceof Error ? error.message : String(error),
        }));
        process.exitCode = 1;
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Failed to close the database pool",
        error: error instanceof Error ? error.message : String(error),
      }));
      process.exitCode = 1;
    }
  });
  return server;
}

module.exports = { createServer };
