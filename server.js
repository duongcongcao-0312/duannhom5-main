const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { randomBytes, randomUUID } = require("node:crypto");
const books = require("./books-data");
const {
  CustomerError,
  Database,
  isOrderStatusTransitionAllowed,
  validateCustomerData,
} = require("./backend/db");
const { PostgresDatabase } = require("./backend/postgres-db");
const { hashOrderRequest } = require("./backend/order-idempotency");
const { getAdminPermission } = require("./backend/router");
const {
  hashPasswordResetToken,
  SessionStore,
  verifyPassword,
} = require("./backend/auth");
const { createEmailMailer } = require("./backend/email");
const { createFirebaseIdTokenVerifier } = require("./backend/firebase-auth");
const {
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
const bookCatalog = new Map(books.map((book) => [book.title, book]));
const allowedDiscountRates = new Set([0, 0.05, 0.1]);
const allowedServiceTypes = new Set(Object.values(SERVICE_TYPES));
const allowedOrderStatuses = new Set(Object.values(ORDER_STATUSES));
const allowedPaymentStatuses = new Set(Object.values(PAYMENT_STATUSES));
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
  },
  login: {
    allowed: ["email", "password"],
    required: ["email", "password"],
    types: { email: "string", password: "string" },
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
};
const allowedServiceStatuses = new Set(Object.values(SERVICE_STATUSES));
const coupons = new Map([
  ["BOOKNEST10", { rate: 0.1, label: "Ưu đãi BookNest" }],
  ["WELCOME5", { rate: 0.05, label: "Ưu đãi chào mừng" }],
]);
const maxRequestBytes = 1024 * 1024;
const defaultBookStock = 12;
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

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentType: user.studentType,
    studentId: user.studentId,
    authProvider: user.authProvider || undefined,
    customerInfo: user.customerInfo || {},
  };
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
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new RequestError(413, "Yêu cầu quá lớn.");
    chunks.push(chunk);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Dữ liệu đơn hàng không hợp lệ.");
  }
  return sanitizePayload(payload);
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

function createOrder(payload, userId = null, requester = null) {
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
  const isStudentAccount = requester?.studentType === "student" ||
    requester?.studentType === "university";
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
  if (couponCode && !coupons.has(couponCode)) {
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
  const couponRate = couponCode ? coupons.get(couponCode).rate : 0;
  const discount = roundMoney(
    subtotal * Math.min(discountRate + couponRate, 0.3),
  );

  const order = {
    orderId: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "received",
    paymentStatus: paymentMethod === "transfer" ? "pending" : "cod_pending",
    customerName,
    phone,
    address,
    paymentMethod,
    discountRate,
    couponCode: couponCode || null,
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

function publicOrder(order) {
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
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
  database,
  sessionTtlMs = Number.isFinite(Number(process.env.SESSION_TTL_MS))
    ? Number(process.env.SESSION_TTL_MS)
    : 7 * 24 * 60 * 60 * 1000,
  passwordResetMailer = createEmailMailer(),
  socialTokenVerifier = createFirebaseIdTokenVerifier(),
  appBaseUrl = process.env.PUBLIC_APP_URL,
  corsOrigins = process.env.CORS_ORIGINS || (
    process.env.RENDER
      ? "https://duongcongcao-0312.github.io"
      : "http://127.0.0.1:8000,http://localhost:8000"
  ),
} = {}) {
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
    }));
  const sessionStore = new SessionStore({ sessionTtlMs, cleanupIntervalMs: 60 * 1000 });
  const loginAttempts = new Map();
  const loginAttemptLimit = 5;
  const loginAttemptWindowMs = 15 * 60 * 1000;
  const passwordResetAttempts = new Map();
  const passwordResetEmailAttempts = new Map();
  let orderWriteQueue = Promise.resolve();
  const allowedOrigins = new Set(
    corsOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  // Load custom books into catalog cache
  db.getCustomBooks()
    .then((custom) => {
      for (const b of custom) {
        if (b && b.title) bookCatalog.set(b.title, b);
      }
    })
    .catch((error) => {
      console.error("Không thể tải sách quản trị:", error);
    });

  async function createAndPersistOrder(payload, userId, requester, idempotencyKey) {
    const operation = orderWriteQueue.then(async () => {
      const order = createOrder(payload, userId, requester);
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
        );
        if (result.conflict) {
          throw new RequestError(
            409,
            "Idempotency-Key đã được sử dụng cho nội dung đơn hàng khác.",
          );
        }
        return result;
      }

      const existingOrders = await db.getAllOrders(ordersPath);
      const existingOrder = existingOrders.find(
        (entry) => entry.idempotencyKey === idempotencyKey,
      );
      if (existingOrder) {
        if (existingOrder.idempotencyHash && existingOrder.idempotencyHash !== requestHash) {
          throw new RequestError(
            409,
            "Idempotency-Key đã được sử dụng cho nội dung đơn hàng khác.",
          );
        }
        return { order: existingOrder, replayed: true };
      }
      validateStock(existingOrders);
      await db.addOrder(order, ordersPath);
      return { order, replayed: false };
    });
    orderWriteQueue = operation.catch(() => {});
    return operation;
  }

  function getAuthUser(request) {
    const authHeader = request.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    return sessionStore.getSession(token);
  }

  function requireCustomerPermission(request, permission) {
    return requireCustomerPermissionMiddleware(
      request,
      permission,
      sessionStore,
      RequestError,
    );
  }

  function requireRole(request, permission) {
    return requireRoleMiddleware(request, permission, sessionStore, RequestError);
  }

  function requireAdmin(request) {
    return requireRole(request, "read:dashboard");
  }

  function applyCustomerFilters(customers, { search = "", status = "", page = 1, limit = 20 } = {}) {
    const normalizedSearch = String(search || "").trim().toLowerCase();
    const normalizedStatus = String(status || "").trim();
    const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 20;

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

    const start = (normalizedPage - 1) * normalizedLimit;
    return filtered.slice(start, start + normalizedLimit);
  }

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
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
    }

    if (request.method === "OPTIONS") {
      response.writeHead(origin && !allowedOrigins.has(origin) ? 403 : 204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Request-Id",
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      sendJson(response, 200, { status: "ok", service: "booknest" });
      return;
    }

    if (requestUrl.pathname === "/ready" && (request.method === "GET" || request.method === "HEAD")) {
      try {
        await db.init();
        sendJson(response, 200, { status: "ready", service: "booknest" });
      } catch (error) {
        logRequestError(
          request,
          response.getHeader("X-Request-Id"),
          error,
          "Readiness check failed",
        );
        sendJson(response, 503, { status: "not_ready", service: "booknest" });
      }
      return;
    }

    // --- API: Coupons (Look up discount coupon) ---
    const couponMatch = requestUrl.pathname.match(
      /^\/api\/coupons\/([A-Za-z0-9_-]+)$/,
    );
    if (couponMatch && request.method === "GET") {
      const coupon = coupons.get(couponMatch[1].toUpperCase());
      if (!coupon) {
        sendJson(response, 404, {
          error: "Mã ưu đãi không hợp lệ hoặc đã hết hạn.",
        });
        return;
      }
      sendJson(response, 200, coupon);
      return;
    }

    // --- API: Auth (Register / Login / Password reset / Profile / Logout) ---
    if (
      requestUrl.pathname === "/api/auth/password-reset" &&
      request.method === "POST"
    ) {
      const payload = requireJsonObject(
        await readJson(request),
        "Email không hợp lệ.",
        payloadSchemas.passwordReset,
      );
      const email = sanitizePlainText(
        typeof payload.email === "string" ? payload.email : String(payload.email || ""),
        254,
      ).toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new RequestError(400, "Vui lòng nhập địa chỉ email hợp lệ.");
      }

      const now = Date.now();
      let resetBase;
      try {
        resetBase = new URL(String(appBaseUrl || ""));
        if (
          !["http:", "https:"].includes(resetBase.protocol) ||
          resetBase.username ||
          resetBase.password ||
          resetBase.search ||
          resetBase.hash
        ) {
          throw new Error("Invalid public app URL.");
        }
        if (!resetBase.pathname.endsWith("/")) resetBase.pathname += "/";
      } catch {
        throw new RequestError(503, "Khôi phục mật khẩu chưa được cấu hình địa chỉ website.");
      }
      await db.init();
      if (!passwordResetMailer) {
        throw new RequestError(503, "Khôi phục mật khẩu chưa được cấu hình email.");
      }

      for (const [key, attempt] of passwordResetAttempts) {
        if (attempt.expiresAt <= now) passwordResetAttempts.delete(key);
      }
      for (const [key, attempt] of passwordResetEmailAttempts) {
        if (attempt.expiresAt <= now) passwordResetEmailAttempts.delete(key);
      }
      const address = request.socket.remoteAddress || "unknown";
      const attempt = passwordResetAttempts.get(address);
      if (attempt && attempt.count >= 30) {
        throw new RequestError(429, "Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.");
      }
      passwordResetAttempts.set(address, {
        count: (attempt?.count || 0) + 1,
        expiresAt: attempt?.expiresAt || now + 15 * 60 * 1000,
      });
      const emailAttempt = passwordResetEmailAttempts.get(email);
      if (emailAttempt && emailAttempt.count >= 5) {
        throw new RequestError(429, "Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.");
      }
      passwordResetEmailAttempts.set(email, {
        count: (emailAttempt?.count || 0) + 1,
        expiresAt: emailAttempt?.expiresAt || now + 15 * 60 * 1000,
      });

      const token = randomBytes(32).toString("hex");
      const tokenHash = hashPasswordResetToken(token);
      const user = await db.createPasswordResetToken(
        email,
        tokenHash,
        new Date(now + 60 * 60 * 1000).toISOString(),
      );
      if (user) {
        resetBase.hash = new URLSearchParams({ resetToken: token }).toString();
        try {
          await passwordResetMailer.sendPasswordReset({
            to: user.email,
            name: user.name,
            url: resetBase.toString(),
          });
        } catch (error) {
          await db.clearPasswordResetToken(tokenHash);
          console.error("Không thể gửi email khôi phục mật khẩu:", error);
          throw new RequestError(
            503,
            "Không thể gửi email khôi phục. Vui lòng kiểm tra cấu hình nhà cung cấp email hoặc thử lại sau.",
          );
        }
      }
      sendJson(response, 200, {
        message: "Nếu email được đăng ký, hướng dẫn khôi phục mật khẩu sẽ được gửi đến hộp thư của bạn.",
      });
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/password-reset/confirm" &&
      request.method === "POST"
    ) {
      const payload = requireJsonObject(
        await readJson(request),
        "Yêu cầu đặt lại mật khẩu không hợp lệ.",
        payloadSchemas.passwordResetConfirm,
      );
      const token = sanitizePlainText(
        typeof payload.token === "string" ? payload.token : String(payload.token || ""),
        128,
      );
      const password = typeof payload.password === "string" ? payload.password : "";
      if (!/^[a-f0-9]{64}$/i.test(token)) {
        throw new RequestError(400, "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.");
      }
      if (password.trim().length < 6 || password.trim().length > 128) {
        throw new RequestError(400, "Mật khẩu mới phải có từ 6 đến 128 ký tự.");
      }
      if (!password.trim()) {
        throw new RequestError(400, "Mật khẩu mới không được để trống.");
      }
      const userId = await db.resetPassword(hashPasswordResetToken(token), password);
      if (!userId) {
        throw new RequestError(400, "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.");
      }
      sessionStore.destroyUserSessions(userId);
      sendJson(response, 200, { message: "Mật khẩu đã được cập nhật." });
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/register" &&
      request.method === "POST"
    ) {
      const payload = requireJsonObject(
        await readJson(request),
        "Vui lòng điền đầy đủ họ tên, email và mật khẩu.",
        payloadSchemas.register,
      );
      const name = sanitizePlainText(
        typeof payload.name === "string" ? payload.name : String(payload.name || ""),
        120,
      );
      const email = sanitizePlainText(
        typeof payload.email === "string" ? payload.email : String(payload.email || ""),
        254,
      ).toLowerCase();
      const password = typeof payload.password === "string" ? payload.password : "";
      if (!name || !email || !password) {
        throw new RequestError(
          400,
          "Vui lòng điền đầy đủ họ tên, email và mật khẩu.",
        );
      }
      if (password.length < 6) {
        throw new RequestError(400, "Mật khẩu phải có ít nhất 6 ký tự.");
      }
      try {
        const user = await db.createUser({
          name,
          email,
          password,
          studentType: sanitizePlainText(
            typeof payload.studentType === "string" ? payload.studentType : "other",
            32,
          ) || "other",
          studentId: sanitizePlainText(
            typeof payload.studentId === "string" ? payload.studentId : "",
            64,
          ),
        });
        const session = sessionStore.createSession(user);
        sendJson(response, 201, {
          token: session.token,
          expiresAt: session.expiresAt,
          user: publicUser(user),
        });
      } catch (err) {
        if (err instanceof Error && err.message === "Email này đã được đăng ký trên hệ thống.") {
          throw new RequestError(409, err.message);
        }
        throw new RequestError(
          503,
          "Hệ thống hiện không thể lưu tài khoản. Vui lòng thử lại sau hoặc liên hệ quản trị viên.",
          err,
        );
      }
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/login" &&
      request.method === "POST"
    ) {
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu đăng nhập không hợp lệ.",
        payloadSchemas.login,
      );
      const now = Date.now();
      for (const [address, attempt] of loginAttempts) {
        if (attempt.expiresAt <= now) loginAttempts.delete(address);
      }
      const address = request.socket.remoteAddress || "unknown";
      const attempt = loginAttempts.get(address);
      if (attempt && attempt.count >= loginAttemptLimit) {
        throw new RequestError(
          429,
          "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        );
      }
      loginAttempts.set(address, {
        count: (attempt?.count || 0) + 1,
        expiresAt: attempt?.expiresAt || now + loginAttemptWindowMs,
      });
      const email = sanitizePlainText(
        typeof payload.email === "string" ? payload.email : String(payload.email || ""),
        254,
      ).toLowerCase();
      const password = typeof payload.password === "string" ? payload.password : "";
      const user = await db.findUserByEmail(email);
      if (!user || !verifyPassword(password, user.password)) {
        throw new RequestError(401, "Email hoặc mật khẩu không chính xác.");
      }
      loginAttempts.delete(address);
      const session = sessionStore.createSession(user);
      sendJson(response, 200, {
        token: session.token,
        expiresAt: session.expiresAt,
        user: publicUser(user),
      });
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/social" &&
      request.method === "POST"
    ) {
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu xác thực không hợp lệ.",
        payloadSchemas.socialAuth,
      );
      const authHeader = request.headers["authorization"] || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "").trim() ||
        (typeof payload.idToken === "string" ? payload.idToken.trim() : "");
      if (!idToken) throw new RequestError(401, "Thiếu Firebase ID Token.");

      let verified;
      try {
        verified = await socialTokenVerifier(idToken);
      } catch (error) {
        throw new RequestError(401, error.message || "Firebase ID Token không hợp lệ.");
      }
      const email = sanitizePlainText(String(verified?.email || ""), 254).toLowerCase();
      const name = sanitizePlainText(String(verified?.name || ""), 120) ||
        email.split("@")[0];
      const provider = sanitizePlainText(String(verified?.provider || "firebase"), 32);
      const providerId = sanitizePlainText(String(verified?.uid || ""), 128);
      if (!verified?.emailVerified || !email || !providerId ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new RequestError(401, "Thông tin Firebase chưa được xác minh đầy đủ.");
      }
      const existingUser = await db.findUserByEmail(email);
      if (existingUser?.role === ROLES.ADMIN) {
        throw new RequestError(403, "Tài khoản quản trị không được đăng nhập bằng social.");
      }
      if (existingUser?.providerId && existingUser.providerId !== providerId) {
        throw new RequestError(403, "Tài khoản social không khớp với tài khoản đã liên kết.");
      }

      const user = await db.findOrCreateSocialUser({
        name,
        email,
        authProvider: provider,
        providerId,
      });

      const session = sessionStore.createSession(user);
      sendJson(response, 200, {
        token: session.token,
        expiresAt: session.expiresAt,
        user: publicUser(user),
      });
      return;
    }

    if (requestUrl.pathname === "/api/auth/me" && request.method === "GET") {
      const user = getAuthUser(request);
      if (!user) {
        throw new RequestError(401, "Chưa đăng nhập.");
      }
      const storedUser = await db.findUserById(user.userId);
      sendJson(response, 200, { user: publicUser(storedUser || user) });
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/customer-info" &&
      request.method === "PATCH"
    ) {
      const session = getAuthUser(request);
      if (!session) throw new RequestError(401, "Chưa đăng nhập.");
      const payload = requireJsonObject(
        await readJson(request),
        "Thông tin khách hàng không hợp lệ.",
        payloadSchemas.customerInfo,
      );

      const customerInfo = {};
      for (const field of ["customerName", "name", "phone", "address"]) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
          const rawValue = payload[field];
          const safeValue = sanitizePlainText(
            typeof rawValue === "string" ? rawValue : String(rawValue || ""),
            field === "phone" ? 20 : 300,
          );
          if (!safeValue && field !== "customerName") {
            throw new RequestError(400, "Thông tin khách hàng không hợp lệ.");
          }
          customerInfo[field] = safeValue;
        }
      }
      const updatedUser = await db.updateCustomerInfo(
        session.userId,
        customerInfo,
        session.email || session.name || "self-service",
      );
      if (!updatedUser)
        throw new RequestError(404, "Không tìm thấy tài khoản.");
      session.customerInfo = updatedUser.customerInfo;
      sendJson(response, 200, { customerInfo: updatedUser.customerInfo });
      return;
    }

    if (
      requestUrl.pathname === "/api/auth/logout" &&
      request.method === "POST"
    ) {
      const authHeader = request.headers["authorization"] || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      sessionStore.destroySession(token);
      sendJson(response, 200, { message: "Đã đăng xuất thành công." });
      return;
    }

    // --- Customer CRM API (public and admin variants) ---
    if (requestUrl.pathname === "/api/customers" && request.method === "GET") {
      requireCustomerPermission(request, "view");
      const customers = await db.getCustomers();
      const filters = validateQuery(
        requestUrl,
        customerQuerySchema,
        "Bộ lọc khách hàng không hợp lệ.",
      );
      const pagedCustomers = applyCustomerFilters(customers, {
        ...filters,
      });
      sendJson(response, 200, pagedCustomers);
      return;
    }

    if (requestUrl.pathname === "/api/customers" && request.method === "POST") {
      const user = requireCustomerPermission(request, "create");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu khách hàng không hợp lệ.",
        payloadSchemas.customer,
      );
      const customer = await db.createCustomer(
        validateCustomerData(payload),
        user.userId,
      );
      sendJson(response, 201, customer);
      return;
    }

    if (
      requestUrl.pathname === "/api/admin/customers" &&
      request.method === "GET"
    ) {
      requireCustomerPermission(request, "view");
      const customers = await db.getCustomers();
      const filters = validateQuery(
        requestUrl,
        customerQuerySchema,
        "Bộ lọc khách hàng không hợp lệ.",
      );
      const pagedCustomers = applyCustomerFilters(customers, {
        ...filters,
      });
      sendJson(response, 200, pagedCustomers);
      return;
    }

    if (
      requestUrl.pathname === "/api/admin/customers" &&
      request.method === "POST"
    ) {
      const user = requireCustomerPermission(request, "create");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu khách hàng không hợp lệ.",
        payloadSchemas.customer,
      );
      const customer = await db.createCustomer(
        validateCustomerData(payload),
        user.userId,
      );
      sendJson(response, 201, customer);
      return;
    }

    const customerMatch = requestUrl.pathname.match(
      /^\/api\/(?:admin\/)?customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (
      customerMatch &&
      (request.method === "GET" ||
        request.method === "PATCH" ||
        request.method === "PUT" ||
        request.method === "DELETE")
    ) {
      if (request.method === "GET") {
        requireCustomerPermission(request, "view");
        const customer = await db.getCustomerById(customerMatch[1]);
        if (!customer) {
          throw new RequestError(404, "Không tìm thấy khách hàng.");
        }
        sendJson(response, 200, customer);
        return;
      }

      if (request.method === "DELETE") {
        const user = requireCustomerPermission(request, "delete");
        const deleted = await db.softDeleteCustomer(customerMatch[1], user.userId);
        if (!deleted) {
          throw new RequestError(404, "Không tìm thấy khách hàng.");
        }
        sendJson(response, 200, { success: true });
        return;
      }

      const user = requireCustomerPermission(request, "update");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu cập nhật khách hàng không hợp lệ.",
        payloadSchemas.customerUpdate,
      );
      const updated =
        payload && payload.status !== undefined
          ? await db.updateCustomerStatus(customerMatch[1], payload.status, user.userId)
          : await db.updateCustomer(customerMatch[1], payload, user.userId);

      if (!updated) {
        throw new RequestError(404, "Không tìm thấy khách hàng.");
      }
      sendJson(response, 200, updated);
      return;
    }

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
      const requester = getAuthUser(request);
      const quote = createOrder({
        customerName: "Báo giá",
        address: "Xem trước đơn hàng",
        phone: "00000000",
        paymentMethod: "cod",
        couponCode: payload.couponCode,
        discountRate: payload.discountRate,
        items: payload.items,
      }, requester?.userId || null, requester);
      sendJson(response, 200, {
        discountRate: quote.discountRate,
        couponCode: quote.couponCode,
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
      return;
    }

    if (requestUrl.pathname === "/api/orders" && request.method === "GET") {
      validateQuery(requestUrl, {}, "Bộ lọc đơn hàng không hợp lệ.");
      const requester = getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để tra cứu đơn hàng.");
      }
      const orders = await db.getAllOrders(ordersPath);
      sendJson(
        response,
        200,
        orders
          .filter((order) => order.userId === requester.userId)
          .map(publicOrder),
      );
      return;
    }

    if (requestUrl.pathname === "/api/orders" && request.method === "POST") {
      if (
        request.headers["content-type"]?.split(";")[0] !== "application/json"
      ) {
        throw new RequestError(415, "Đơn hàng cần được gửi ở định dạng JSON.");
      }

      const requester = getAuthUser(request);
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
      const { order, replayed } = await createAndPersistOrder(
        payload,
        requester?.userId || null,
        requester,
        idempotencyKey,
      );
      sendJson(response, replayed ? 200 : 201, publicOrder(order));
      return;
    }

    const orderMatch = requestUrl.pathname.match(
      /^\/api\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (orderMatch && request.method === "GET") {
      const order = await db.findOrderById(orderMatch[1], ordersPath);
      if (!order) {
        sendJson(response, 404, { error: "Không tìm thấy đơn hàng." });
        return;
      }
      const requester = getAuthUser(request);
      if (requester && requester.role !== ROLES.ADMIN) {
        if (order.userId && order.userId !== requester.userId) {
          throw new RequestError(
            403,
            "Bạn không có quyền xem đơn hàng của người dùng khác.",
          );
        }
        if (order.userId && order.userId === requester.userId) {
          sendJson(response, 200, publicOrder(order));
          return;
        }
      }
      if (!requester && order.userId) {
        throw new RequestError(
          401,
          "Vui lòng đăng nhập để xem thông tin đơn hàng này.",
        );
      }
      sendJson(response, 200, publicOrder(order));
      return;
    }

    if (orderMatch && (request.method === "PATCH" || request.method === "PUT")) {
      const requester = getAuthUser(request);
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
      if (payload.items !== undefined) {
        if (!Array.isArray(payload.items) || payload.items.length === 0) {
          throw new RequestError(400, "Danh sách sản phẩm cập nhật không hợp lệ.");
        }
        for (const item of payload.items) {
          if (!Number.isInteger(item?.quantity) || item.quantity < 1) {
            throw new RequestError(400, "Số lượng sách phải là số nguyên lớn hơn 0.");
          }
        }
      }
      const safePayload = { ...payload };
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
      const updated = await db.updateOrderStatus(
        orderMatch[1],
        safePayload,
        ordersPath,
      );
      if (!updated) {
        throw new RequestError(404, "Không tìm thấy đơn hàng.");
      }
      sendJson(response, 200, updated);
      return;
    }

    // --- API: Services (Thuê / Thu mua / Trao đổi) ---
    if (requestUrl.pathname === "/api/services" && request.method === "POST") {
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu yêu cầu dịch vụ không hợp lệ.",
        payloadSchemas.service,
      );
      const bookTitle = sanitizePlainText(
        typeof payload.bookTitle === "string" ? payload.bookTitle : String(payload.bookTitle || ""),
        200,
      );
      const name = sanitizePlainText(
        typeof payload.name === "string" ? payload.name : String(payload.name || ""),
        120,
      );
      const phone = sanitizePlainText(
        typeof payload.phone === "string" ? payload.phone : String(payload.phone || ""),
        20,
      );
      const service = sanitizePlainText(
        typeof payload.service === "string" ? payload.service : String(payload.service || ""),
        32,
      );
      if (!bookTitle || !name || !phone || !service) {
        throw new RequestError(400, "Vui lòng nhập đầy đủ thông tin dịch vụ.");
      }
      if (!allowedServiceTypes.has(service)) {
        throw new RequestError(400, "Loại dịch vụ không hợp lệ.");
      }
      const entry = await db.addServiceRequest({
        ...payload,
        bookTitle,
        name,
        phone,
        service,
        condition: sanitizePlainText(
          typeof payload.condition === "string" ? payload.condition : "",
          64,
        ),
        note: sanitizePlainText(
          typeof payload.note === "string" ? payload.note : "",
          500,
        ),
      });
      sendJson(response, 201, {
        message: "Đã gửi yêu cầu thành công.",
        request: entry,
      });
      return;
    }

    // --- API: Books Catalog (Base + Custom) ---
    if (requestUrl.pathname === "/api/books" && request.method === "GET") {
      const custom = await db.getCustomBooks();
      const allBooks = [...books, ...custom];
      sendJson(response, 200, allBooks);
      return;
    }

    // --- Admin API: Stats ---
    if (
      requestUrl.pathname === "/api/admin/stats" &&
      request.method === "GET"
    ) {
      requireRole(request, "read:dashboard");
      const stats = await db.getStats(ordersPath, books.length);
      sendJson(response, 200, stats);
      return;
    }

    // --- Admin API: Orders (Full detail, status update) ---
    if (
      requestUrl.pathname === "/api/admin/orders" &&
      request.method === "GET"
    ) {
      requireRole(request, "read:orders");
      const orders = await db.getAllOrders(ordersPath);
      sendJson(response, 200, orders);
      return;
    }

    const adminOrderMatch = requestUrl.pathname.match(
      /^\/api\/admin\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (
      adminOrderMatch &&
      (request.method === "PATCH" || request.method === "PUT")
    ) {
      requireRole(request, "write:orders");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu cập nhật đơn hàng không hợp lệ.",
        payloadSchemas.orderStatusUpdate,
      );
      const safePayload = {
        ...payload,
      };
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
      const updated = await db.updateOrderStatus(
        adminOrderMatch[1],
        safePayload,
        ordersPath,
      );
      if (!updated) {
        throw new RequestError(404, "Không tìm thấy đơn hàng.");
      }
      sendJson(response, 200, updated);
      return;
    }

    // --- Admin API: Services ---
    if (
      requestUrl.pathname === "/api/admin/services" &&
      request.method === "GET"
    ) {
      requireRole(request, "read:services");
      const list = await db.getServiceRequests();
      sendJson(response, 200, list);
      return;
    }

    const adminServiceMatch = requestUrl.pathname.match(
      /^\/api\/admin\/services\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (
      adminServiceMatch &&
      (request.method === "PATCH" || request.method === "PUT")
    ) {
      requireRole(request, "write:services");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu cập nhật yêu cầu dịch vụ không hợp lệ.",
        payloadSchemas.serviceStatus,
      );
      const status =
        sanitizePlainText(payload.status, 32);
      if (
        status !== undefined &&
        !allowedServiceStatuses.has(status)
      ) {
        throw new RequestError(400, "Trạng thái yêu cầu dịch vụ không hợp lệ.");
      }
      const updated = await db.updateServiceRequestStatus(
        adminServiceMatch[1],
        status,
      );
      if (!updated) {
        throw new RequestError(404, "Không tìm thấy yêu cầu.");
      }
      sendJson(response, 200, updated);
      return;
    }

    // --- Admin API: Books Management ---
    if (
      requestUrl.pathname === "/api/admin/books" &&
      request.method === "POST"
    ) {
      requireRole(request, "write:books");
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu sách không hợp lệ.",
        payloadSchemas.book,
      );
      const title = sanitizePlainText(
        typeof payload.title === "string" ? payload.title : String(payload.title || ""),
        200,
      );
      const author = sanitizePlainText(
        typeof payload.author === "string" ? payload.author : String(payload.author || ""),
        200,
      );
      const price = Number(payload.price);
      if (!title || !author || !Number.isFinite(price) || price < 0) {
        throw new RequestError(400, "Vui lòng nhập tên sách, tác giả và giá.");
      }
      const newBook = await db.addCustomBook({
        ...payload,
        title,
        author,
        price,
        category: sanitizePlainText(
          typeof payload.category === "string" ? payload.category : "",
          64,
        ) || "van-hoc",
        description: sanitizePlainText(
          typeof payload.description === "string" ? payload.description : "",
          1000,
        ),
      });
      bookCatalog.set(newBook.title, newBook);
      sendJson(response, 201, newBook);
      return;
    }

    const adminBookMatch = requestUrl.pathname.match(
      /^\/api\/admin\/books\/([A-Za-z0-9_-]{1,128})$/i,
    );
    if (
      adminBookMatch &&
      (request.method === "PUT" || request.method === "PATCH")
    ) {
      requireRole(request, "write:books");
      const previousBooks = await db.getCustomBooks();
      const previous = previousBooks.find((book) => book.id === adminBookMatch[1]);
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu cập nhật sách không hợp lệ.",
        payloadSchemas.bookUpdate,
      );
      const updated = await db.updateCustomBook(adminBookMatch[1], payload);
      if (!updated) {
        throw new RequestError(404, "Không tìm thấy sách.");
      }
      if (previous?.title && previous.title !== updated.title) {
        bookCatalog.delete(previous.title);
      }
      if (updated.title) bookCatalog.set(updated.title, updated);
      sendJson(response, 200, updated);
      return;
    }

    if (adminBookMatch && request.method === "DELETE") {
      requireRole(request, "write:books");
      const previousBooks = await db.getCustomBooks();
      const previous = previousBooks.find((book) => book.id === adminBookMatch[1]);
      const deleted = await db.deleteCustomBook(adminBookMatch[1]);
      if (deleted && previous?.title) bookCatalog.delete(previous.title);
      sendJson(response, 200, { success: deleted });
      return;
    }

    // --- Admin API: Users Management ---
    if (
      requestUrl.pathname === "/api/admin/users" &&
      request.method === "GET"
    ) {
      requireRole(request, "read:users");
      const users = await db.getUsers();
      const safeUsers = users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        studentType: u.studentType,
        studentId: u.studentId,
        createdAt: u.createdAt,
      }));
      sendJson(response, 200, safeUsers);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/admin/")) {
      const requester = getAuthUser(request);
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
      console.error(`Không thể dừng server an toàn: ${error.message}`);
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
