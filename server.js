const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const catalogBooks = require("./books-data");
const { buildSecurityHeaders, checkRateLimit, sanitizeErrorMessage, hashPasswordResetToken, verifyPasswordResetToken, generatePasswordResetToken, parseCorsOrigins, isOriginAllowed } = require("./backend/security");
const { Database, CustomerError } = require("./backend/db");
const { PostgresDatabase } = require("./backend/postgres-db");
const { hashPassword, verifyPassword, SessionStore, isPasswordValid } = require("./backend/auth");
const { authenticate, requireRole, requireCustomerPermission } = require("./backend/authorization");
const { ROLES, PAYMENT_STATUSES, ORDER_STATUSES } = require("./backend/business-constants");
const { findRoute } = require("./backend/router");

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isProductionEnvironment() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function isValidAdminEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateProductionEnvironment() {
  if (!isProductionEnvironment()) return;
  const email = String(process.env.ADMIN_EMAIL || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!isValidAdminEmail(email) || password.length < 12) {
    throw new Error("Production requires a valid ADMIN_EMAIL and ADMIN_PASSWORD.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("Production requires a shared PostgreSQL session store.");
  }
}

function validateRenderEnvironment() {
  if (String(process.env.RENDER || "").toLowerCase() === "true" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL phải được cấu hình trên Render.");
  }
}

function getRequestId(req) {
  return req.headers["x-request-id"] || crypto.randomUUID();
}

function getClientAddress(req) {
  const value = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";
  return String(value).split(",")[0].trim() || "127.0.0.1";
}

function jsonResponsePayload(payload) {
  return JSON.stringify(payload);
}

function safeOrigin(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function tryDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname || "");
  } catch {
    return null;
  }
}

function isUnsafePathname(pathname) {
  if (typeof pathname !== "string") return true;
  const rawPath = pathname.split("?")[0];
  const decoded = tryDecodePathname(rawPath);
  if (decoded === null) return true;
  if (decoded.includes("\\") || decoded.includes("\0")) return true;
  const normalized = decoded.replace(/\/+/g, "/");
  if (/^\/\.git(?:\/.+)?$/i.test(normalized) || /^\/\.env(?:\/.+)?$/i.test(normalized) || /^\/data(?:\/.+)?$/i.test(normalized)) {
    return true;
  }
  const segments = normalized.split("/");
  return segments.some((segment) => segment === ".." || segment === ".");
}

async function parseJsonBody(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE" && !contentType.toLowerCase().includes("application/json")) {
    throw new RequestError(415, "Yêu cầu JSON không hợp lệ.");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    throw new RequestError(400, "Dữ liệu JSON không hợp lệ.");
  }
}

async function runWithErrorHandling(req, res, handler) {
  const requestId = getRequestId(req);
  const isHead = req.method === "HEAD";

  try {
    const result = await handler();
    if (result === undefined) {
      res.writeHead(204, { "x-request-id": requestId, ...buildSecurityHeaders({ isProduction: isProductionEnvironment() }) });
      if (!isHead) res.end();
      else res.end();
      return;
    }

    const { status = 200, headers = {}, body, json = null } = result;
    const finalHeaders = {
      ...buildSecurityHeaders({ isProduction: isProductionEnvironment() }),
      ...headers,
      "x-request-id": requestId,
    };

    if (json !== null) {
      finalHeaders["content-type"] = "application/json; charset=utf-8";
      if (json && typeof json === "object" && Object.hasOwn(json, "error")) {
        finalHeaders["cache-control"] = "no-store";
      }
    }

    res.writeHead(status, finalHeaders);
    if (isHead) {
      res.end();
      return;
    }
    if (body !== undefined) {
      res.end(body);
      return;
    }
    if (json !== null) {
      res.end(typeof json === "string" ? json : jsonResponsePayload(json));
      return;
    }
    res.end();
  } catch (error) {
    const status = error && typeof error.status === "number" ? error.status : 500;
    const message = error && error.message ? error.message : "Máy chủ gặp lỗi khi xử lý yêu cầu.";
    const sanitizedMessage = sanitizeErrorMessage(error, status);
    const output = { error: sanitizedMessage };
    res.writeHead(status, {
      ...buildSecurityHeaders({ isProduction: isProductionEnvironment() }),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    });
    if (isHead) {
      res.end();
      return;
    }
    res.end(jsonResponsePayload(output));
  }
}

async function readFileSafely(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function buildCatalogBook(book, index = 0) {
  const normalized = {
    ...book,
    id: book.id || `catalog-${index + 1}`,
    isCustom: Boolean(book.isCustom),
    stock: Number.isFinite(Number(book.stock)) ? Number(book.stock) : 12,
    price: Number(book.price) || 0,
    updatedAt: book.updatedAt || new Date(0).toISOString(),
  };
  if (!normalized.image && normalized.cover) normalized.image = normalized.cover;
  return normalized;
}

function getBaseCatalogBooks() {
  return catalogBooks.map((book, index) => buildCatalogBook(book, index));
}

async function listBooks(database) {
  const baseBooks = getBaseCatalogBooks();
  const customEntries = await database.getCustomBooks().catch(() => []);
  const catalogOverrides = await database.getCatalogBookOverrides().catch(() => []);
  const catalogMap = new Map(baseBooks.map((book) => [book.id, book]));
  for (const override of catalogOverrides) {
    if (override && override.id) catalogMap.set(override.id, { ...catalogMap.get(override.id), ...override, isCustom: false });
  }
  const merged = [...baseBooks.map((book) => catalogMap.get(book.id) || book)];
  for (const customBook of customEntries) {
    if (customBook && customBook.id) merged.push({ ...customBook, isCustom: true });
  }
  return merged;
}

function serializeUser(user) {
  if (!user || typeof user !== "object") return null;
  const publicUser = { ...user };
  delete publicUser.password;
  delete publicUser.passwordHash;
  delete publicUser.passwordResetToken;
  delete publicUser.passwordAuthEnabled;
  delete publicUser.token;
  delete publicUser.refreshToken;
  delete publicUser.refreshTokenHash;
  delete publicUser.salt;
  delete publicUser.customerInfo;
  return publicUser;
}

function asNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getAdminSessionUser(req, sessionStore) {
  const header = String(req.headers.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token ? sessionStore.getSession(token) : null;
}

function createServer(options = {}) {
  validateProductionEnvironment();
  validateRenderEnvironment();

  const rootDir = options.root || path.resolve(__dirname);
  const usersPath = options.usersPath || path.join(rootDir, "data", "users.json");
  const ordersPath = options.ordersPath || path.join(rootDir, "data", "orders.jsonl");
  const servicesPath = options.servicesPath || path.join(rootDir, "data", "service-requests.jsonl");
  const booksPath = options.booksPath || path.join(rootDir, "data", "books.json");
  const couponsPath = options.couponsPath || path.join(rootDir, "data", "coupons.json");
  const customersPath = options.customersPath || path.join(rootDir, "data", "customers.json");
  const customerInteractionsPath = options.customerInteractionsPath || path.join(rootDir, "data", "customer-interactions.json");

  const database = options.database || new Database({
    root: rootDir,
    ordersPath,
    usersPath,
    servicesPath,
    booksPath,
    couponsPath,
    customersPath,
    customerInteractionsPath,
  });

  const sessionStore = new SessionStore({
    repository: (database && typeof database.saveSessionRecord === "function") ? database : null,
    sessionTtlMs: Number.isFinite(Number(options.sessionTtlMs)) ? Number(options.sessionTtlMs) : undefined,
    refreshTtlMs: Number.isFinite(Number(options.refreshTtlMs)) ? Number(options.refreshTtlMs) : undefined,
    cleanupIntervalMs: Number.isFinite(Number(options.cleanupIntervalMs)) ? Number(options.cleanupIntervalMs) : 60_000,
  });

  const server = http.createServer((req, res) => {
    const rawUrl = req.url || "/";
    const reqUrl = new URL(rawUrl, "http://127.0.0.1");
    const pathname = reqUrl.pathname.replace(/\/+/g, "/");

    if (isUnsafePathname(rawUrl)) {
      return runWithErrorHandling(req, res, async () => ({ status: 400, json: { error: "Đường dẫn không hợp lệ." } }));
    }

    const routeHandler = async () => {
      if (req.method === "OPTIONS") {
        return { status: 204, headers: { allow: "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS" } };
      }

      if (pathname === "/health") {
        const body = { status: "ok", service: "booknest" };
        return { status: 200, json: body };
      }

      if (pathname === "/ready") {
        try {
          if (typeof database.init === "function") await database.init();
          if (typeof database.getCustomBooks === "function") await database.getCustomBooks();
          return { status: 200, json: { status: "ready", service: "booknest" } };
        } catch (error) {
          throw new RequestError(503, "Persistence unavailable");
        }
      }

      if (pathname === "/") {
        const body = await readFileSafely(path.join(rootDir, "index.html"));
        if (!body) return { status: 404, json: { error: "Trang không tồn tại." } };
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: body.toString("utf8") };
      }

      const decodedPathname = tryDecodePathname(pathname);
      if (decodedPathname === null || isUnsafePathname(pathname)) {
        return { status: 400, json: { error: "Đường dẫn không hợp lệ." } };
      }

      if (pathname.startsWith("/api/") === false && !pathname.startsWith("/assets/") && !pathname.startsWith("/admin") && !pathname.startsWith("/privacy") && !pathname.startsWith("/terms") && !pathname.startsWith("/404") && !pathname.startsWith("/500") && !pathname.startsWith("/robots") && !pathname.startsWith("/sitemap") && !pathname.startsWith("/manifest") && !pathname.startsWith("/favicon")) {
        const relativePath = decodedPathname.replace(/^\/+/, "");
        const staticPath = path.join(rootDir, relativePath);
        const resolved = path.resolve(staticPath);
        if (resolved.startsWith(path.resolve(rootDir)) && (await fs.stat(resolved).then(() => true).catch(() => false))) {
          const data = await fs.readFile(resolved);
          return { status: 200, headers: { "content-type": getMimeType(resolved) }, body: data };
        }
      }

      const staticPath = pathname === "/" ? path.join(rootDir, "index.html") : path.join(rootDir, decodedPathname.replace(/^\/+/, ""));
      if (!pathname.startsWith("/api/")) {
        const safeFile = path.resolve(rootDir, decodedPathname.replace(/^\/+/, ""));
        if (safeFile.startsWith(path.resolve(rootDir)) && safeFile !== path.resolve(rootDir)) {
          const data = await readFileSafely(safeFile);
          if (data) {
            return { status: 200, headers: { "content-type": getMimeType(safeFile) }, body: data };
          }
        }
      }

      if (pathname === "/api/books") {
        if (req.method !== "GET") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const books = await listBooks(database);
        return { status: 200, json: books };
      }

      if (pathname.startsWith("/api/coupons/")) {
        if (req.method !== "GET") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const code = decodeURIComponent(pathname.split("/api/coupons/")[1] || "").trim();
        if (!code) return { status: 404, json: { error: "Mã ưu đãi không tồn tại." } };
        const coupons = await database.getCoupons().catch(() => []);
        const match = coupons.find((coupon) => String(coupon.code).toUpperCase() === String(code).toUpperCase());
        if (!match) return { status: 404, json: { error: "Mã ưu đãi không tồn tại." } };
        const now = Date.now();
        const startsAt = match.startsAt ? new Date(match.startsAt).getTime() : 0;
        const expiresAt = match.expiresAt ? new Date(match.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (!match.enabled || (Number(match.maxUses) > 0 && Number(match.usedCount || 0) >= Number(match.maxUses))) {
          return { status: 404, json: { error: "Mã ưu đãi không còn hiệu lực." } };
        }
        if (new Date(match.startsAt || 0).getTime() > now || now > expiresAt) {
          return { status: 404, json: { error: "Mã ưu đãi không còn hiệu lực." } };
        }
        const publicCoupon = { ...match };
        delete publicCoupon.usedCount;
        delete publicCoupon.isUsed;
        return { status: 200, json: publicCoupon };
      }

      if (pathname === "/api/orders" && req.method === "GET") {
        const user = await authenticate(req, sessionStore, RequestError);
        const orders = await database.getAllOrders().catch(() => []);
        const userOrders = orders.filter((order) => String(order.userId || "") === String(user.id) || String(order.userEmail || "") === String(user.email || ""));
        return { status: 200, json: userOrders };
      }

      if (pathname === "/api/orders" && req.method === "POST") {
        const payload = await parseJsonBody(req);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new RequestError(400, "Dữ liệu đơn hàng không hợp lệ.");
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0) throw new RequestError(400, "Đơn hàng phải có ít nhất một sản phẩm.");
        const normalizedItems = items.map((item) => ({
          title: String(item.title || "").trim(),
          quantity: Number(item.quantity) || 0,
        })).filter((item) => item.title && item.quantity > 0);
        if (normalizedItems.length === 0) throw new RequestError(400, "Sản phẩm trong đơn hàng không hợp lệ.");
        const subtotal = normalizedItems.reduce((sum, item) => sum + (Number(item.quantity) * 89000), 0);
        const parsedDiscountRate = Number(payload.discountRate || 0);
        const discount = Math.round(subtotal * Math.min(Math.max(parsedDiscountRate, 0), 1));
        const total = Math.max(0, subtotal - discount);
        const orderId = crypto.randomUUID();
        const order = {
          orderId,
          idempotencyKey: req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          userId: payload.userId || null,
          customerName: String(payload.customerName || "").trim() || "Khách hàng",
          address: String(payload.address || "").trim() || "",
          phone: String(payload.phone || "").trim(),
          paymentMethod: String(payload.paymentMethod || "cod").trim(),
          status: "pending",
          paymentStatus: payload.paymentMethod === "transfer" ? "pending" : "cod_pending",
          items: normalizedItems.map((item) => ({ ...item, unitPrice: 89000, lineTotal: item.quantity * 89000 })),
          subtotal,
          discount,
          total,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (payload.couponCode) {
          const coupons = await database.getCoupons().catch(() => []);
          const matched = coupons.find((coupon) => String(coupon.code).toUpperCase() === String(payload.couponCode).toUpperCase());
          if (matched) {
            const now = Date.now();
            const started = matched.startsAt ? new Date(matched.startsAt).getTime() : 0;
            const expired = matched.expiresAt ? new Date(matched.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
            if (matched.enabled && now >= started && now <= expired && (Number(matched.maxUses) <= 0 || Number(matched.usedCount || 0) < Number(matched.maxUses))) {
              const appliedDiscount = Math.round(total * Number(matched.rate || 0));
              order.discount = Math.max(order.discount, appliedDiscount);
              order.total = Math.max(0, subtotal - order.discount);
              order.couponCode = matched.code;
            }
          }
        }
        const persisted = await database.addOrder(order).catch(() => null);
        if (!persisted) return { status: 500, json: { error: "Không thể lưu đơn hàng." } };
        return { status: 201, json: order };
      }

      if (pathname.startsWith("/api/orders/") && pathname.split("/").length === 4) {
        const match = /^\/api\/orders\/([^/]+)$/.exec(pathname);
        if (!match) return { status: 404, json: { error: "Đơn hàng không tồn tại." } };
        const orderId = decodeURIComponent(match[1]);
        if (req.method === "GET") {
          const order = await database.findOrderById(orderId).catch(() => null);
          if (!order) return { status: 404, json: { error: "Đơn hàng không tồn tại." } };
          const publicOrder = {
            orderId: order.orderId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            total: order.total,
            subtotal: order.subtotal,
            discount: order.discount,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            items: order.items,
          };
          return { status: 200, json: publicOrder };
        }
        if (req.method === "PATCH") {
          const user = await authenticate(req, sessionStore, RequestError);
          const payload = await parseJsonBody(req);
          const order = await database.findOrderById(orderId).catch(() => null);
          if (!order) return { status: 404, json: { error: "Đơn hàng không tồn tại." } };
          if (String(order.userId || "") !== String(user.id) && String(order.userEmail || "") !== String(user.email || "")) {
            return { status: 403, json: { error: "Bạn không có quyền cập nhật đơn hàng này." } };
          }
          const nextStatus = String(payload?.status || order.status).trim();
          const updated = await database.updateOrderStatus(orderId, { status: nextStatus }, undefined, { actorRole: user.role || ROLES.USER, actorId: user.id }).catch((error) => { throw error; });
          return { status: 200, json: updated };
        }
      }

      if (pathname === "/api/orders/quote") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const payload = await parseJsonBody(req);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * 89000), 0);
        const couponCode = String(payload?.couponCode || "").trim();
        let discount = 0;
        if (couponCode) {
          const coupons = await database.getCoupons().catch(() => []);
          const match = coupons.find((coupon) => String(coupon.code).toUpperCase() === couponCode.toUpperCase());
          if (match && match.enabled) {
            discount = Math.round(subtotal * Number(match.rate || 0));
          }
        }
        return { status: 200, json: { subtotal, discount, total: Math.max(0, subtotal - discount) } };
      }

      if (pathname === "/api/services") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const payload = await parseJsonBody(req);
        const service = await database.addServiceRequest(payload || {}).catch((error) => { throw new RequestError(400, error.message || "Dữ liệu yêu cầu dịch vụ không hợp lệ."); });
        return { status: 201, json: service };
      }

      if (pathname === "/api/auth/register") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const payload = await parseJsonBody(req);
        const email = String(payload?.email || "").trim().toLowerCase();
        const password = String(payload?.password || "");
        const name = String(payload?.name || "").trim();
        if (!email || !isValidAdminEmail(email) || !password || !isPasswordValid(password)) {
          throw new RequestError(400, "Email hoặc mật khẩu không hợp lệ.");
        }
        const existing = await database.findUserByEmail(email).catch(() => null);
        if (existing) throw new RequestError(409, "Email này đã được đăng ký.");
        const user = await database.createUser({
          name,
          email,
          password: hashPassword(password),
          role: "user",
          createdAt: Date.now(),
        });
        const session = await sessionStore.createSession({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || "user",
        });
        return { status: 201, headers: { "cache-control": "no-store" }, json: { token: session.token, expiresAt: session.expiresAt, user: serializeUser(user) } };
      }

      if (pathname === "/api/auth/login") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const clientIp = getClientAddress(req);
        const rateLimit = await checkRateLimit(`auth-login:${clientIp}`, 5, 15 * 60 * 1000);
        if (!rateLimit.allowed) {
          throw new RequestError(429, "Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.");
        }
        const payload = await parseJsonBody(req);
        const email = String(payload?.email || "").trim().toLowerCase();
        const password = String(payload?.password || "");
        const user = await database.findUserByEmail(email).catch(() => null);
        if (!user || !verifyPassword(password, user.password)) {
          throw new RequestError(401, "Email hoặc mật khẩu không đúng.");
        }
        const session = await sessionStore.createSession({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || "user",
        });
        return { status: 200, headers: { "cache-control": "no-store" }, json: { token: session.token, expiresAt: session.expiresAt, user: serializeUser(user) } };
      }

      if (pathname === "/api/auth/me") {
        const user = await authenticate(req, sessionStore, RequestError);
        return { status: 200, json: serializeUser(user) };
      }

      if (pathname === "/api/auth/logout") {
        const user = await authenticate(req, sessionStore, RequestError);
        const header = String(req.headers.authorization || "");
        const token = header.replace(/^Bearer\s+/i, "").trim();
        await sessionStore.destroySession(token);
        return { status: 200, json: { ok: true } };
      }

      if (pathname === "/api/auth/customer-info") {
        const user = await authenticate(req, sessionStore, RequestError);
        const payload = await parseJsonBody(req);
        const updated = await database.updateCustomerInfo(user.id, payload || {}, user.name || "system").catch((error) => { throw new RequestError(400, error.message || "Không thể cập nhật thông tin khách hàng."); });
        return { status: 200, json: updated };
      }

      if (pathname === "/api/auth/password-reset") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const payload = await parseJsonBody(req);
        const email = String(payload?.email || "").trim().toLowerCase();
        if (!email) return { status: 400, json: { error: "Email không hợp lệ." } };
        const user = await database.findUserByEmail(email).catch(() => null);
        if (!user) return { status: 200, json: { ok: true } };
        const token = generatePasswordResetToken();
        const hash = hashPasswordResetToken(token);
        await database.createPasswordResetToken(email, hash, Date.now() + 3600000);
        return { status: 200, json: { ok: true } };
      }

      if (pathname === "/api/auth/password-reset/confirm") {
        if (req.method !== "POST") return { status: 405, json: { error: "Phương thức không được hỗ trợ." } };
        const payload = await parseJsonBody(req);
        const token = String(payload?.token || "").trim();
        const password = String(payload?.password || "");
        if (!token || !password || !isPasswordValid(password)) throw new RequestError(400, "Thông tin đặt lại mật khẩu không hợp lệ.");
        const reset = await database.resetPassword(hashPasswordResetToken(token), password).catch((error) => { throw new RequestError(400, error.message || "Token không hợp lệ."); });
        if (!reset) throw new RequestError(400, "Token không hợp lệ hoặc đã hết hạn.");
        return { status: 200, json: { ok: true } };
      }

      if (pathname === "/api/admin/stats") {
        const user = await requireRole(req, "read:dashboard", sessionStore, RequestError);
        const stats = await database.getStats().catch(() => ({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, totalBooks: 0, totalServices: 0 }));
        return { status: 200, json: stats };
      }

      if (pathname === "/api/admin/orders" && req.method === "GET") {
        await requireRole(req, "read:orders", sessionStore, RequestError);
        const orders = await database.getAllOrders().catch(() => []);
        return { status: 200, json: orders };
      }

      if (pathname.startsWith("/api/admin/orders/") && req.method === "PATCH") {
        const user = await requireRole(req, "write:orders", sessionStore, RequestError);
        const orderId = decodeURIComponent(pathname.replace("/api/admin/orders/", ""));
        const payload = await parseJsonBody(req);
        const updated = await database.updateOrderStatus(orderId, payload, undefined, { actorRole: user.role || ROLES.ADMIN, actorId: user.id }).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật đơn hàng."); });
        return { status: 200, json: updated };
      }

      if (pathname === "/api/admin/books" && req.method === "GET") {
        await requireRole(req, "read:books", sessionStore, RequestError);
        const books = await listBooks(database);
        return { status: 200, json: books };
      }

      if (pathname === "/api/admin/books" && req.method === "POST") {
        const user = await requireRole(req, "write:books", sessionStore, RequestError);
        const payload = await parseJsonBody(req);
        const created = await database.addCustomBook(payload || {}).catch((error) => { throw new RequestError(400, error.message || "Không thể thêm sách."); });
        return { status: 201, json: created };
      }

      if (pathname.startsWith("/api/admin/books/") && ["PUT", "PATCH", "DELETE"].includes(req.method)) {
        const id = decodeURIComponent(pathname.replace("/api/admin/books/", ""));
        const user = await requireRole(req, "write:books", sessionStore, RequestError);
        if (req.method === "DELETE") {
          const deleted = await database.deleteCustomBook(id).catch((error) => { throw new RequestError(400, error.message || "Không thể xóa sách."); });
          return { status: 200, json: { ok: deleted } };
        }
        const payload = await parseJsonBody(req);
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new RequestError(400, "Dữ liệu sách không hợp lệ.");
        const current = await database.readBookRecords().catch(() => []);
        const match = current.find((book) => book.id === id || book.title === id || book.id === decodeURIComponent(id));
        if (match && !match.catalogOverride) {
          const updated = await database.updateCustomBook(id, payload, payload.updatedAt).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật sách."); });
          return { status: 200, json: updated };
        }
        const baseBook = getBaseCatalogBooks().find((book) => book.id === id || book.title === id);
        const updated = await database.updateCatalogBook(id, payload, payload.updatedAt, baseBook || {}).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật sách."); });
        return { status: 200, json: updated };
      }

      if (pathname === "/api/admin/coupons" && req.method === "GET") {
        await requireRole(req, "read:coupons", sessionStore, RequestError);
        const coupons = await database.getCoupons().catch(() => []);
        return { status: 200, json: coupons };
      }

      if (pathname === "/api/admin/coupons" && req.method === "POST") {
        await requireRole(req, "write:coupons", sessionStore, RequestError);
        const payload = await parseJsonBody(req);
        const created = await database.saveCoupon({ ...payload, enabled: payload.enabled !== false }, undefined, true).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể tạo coupon."); });
        return { status: 201, json: created };
      }

      if (pathname.startsWith("/api/admin/coupons/") && ["PUT", "PATCH"].includes(req.method)) {
        await requireRole(req, "write:coupons", sessionStore, RequestError);
        const code = decodeURIComponent(pathname.replace("/api/admin/coupons/", ""));
        const payload = await parseJsonBody(req);
        const current = await database.getCoupons().catch(() => []);
        const match = current.find((coupon) => String(coupon.code).toUpperCase() === String(code).toUpperCase());
        if (!match) return { status: 404, json: { error: "Coupon không tồn tại." } };
        const updated = await database.saveCoupon({ ...match, ...payload, code: match.code }, match.updatedAt, false).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật coupon."); });
        return { status: 200, json: updated };
      }

      if (pathname === "/api/admin/customers" && req.method === "GET") {
        await requireRole(req, "read:customers", sessionStore, RequestError);
        const customers = await database.getCustomers().catch(() => []);
        return { status: 200, json: customers };
      }

      if (pathname === "/api/admin/staff" && req.method === "GET") {
        await requireRole(req, "read:staff", sessionStore, RequestError);
        const staff = await database.getStaffUsers().catch(() => []);
        return { status: 200, json: staff };
      }

      if (pathname === "/api/admin/staff" && req.method === "POST") {
        const user = await requireRole(req, "write:staff", sessionStore, RequestError);
        const payload = await parseJsonBody(req);
        const created = await database.createStaffUser(payload || {}, user.id).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể tạo nhân viên."); });
        return { status: 201, json: created };
      }

      if (pathname.startsWith("/api/admin/staff/") && req.method === "PATCH") {
        const user = await requireRole(req, "write:staff", sessionStore, RequestError);
        const id = decodeURIComponent(pathname.replace("/api/admin/staff/", ""));
        const payload = await parseJsonBody(req);
        const updated = await database.updateStaffUser(id, payload || {}, user.id).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật nhân viên."); });
        return { status: 200, json: updated };
      }

      if (pathname.startsWith("/api/admin/customers/") && req.method === "GET") {
        await requireRole(req, "read:customers", sessionStore, RequestError);
        const customerId = decodeURIComponent(pathname.replace("/api/admin/customers/", ""));
        const customer = await database.getCustomerById(customerId).catch(() => null);
        if (!customer) return { status: 404, json: { error: "Khách hàng không tồn tại." } };
        return { status: 200, json: customer };
      }

      if (pathname.startsWith("/api/admin/customers/") && req.method === "PATCH") {
        const user = await requireRole(req, "write:customers", sessionStore, RequestError);
        const customerId = decodeURIComponent(pathname.replace("/api/admin/customers/", ""));
        const payload = await parseJsonBody(req);
        const updated = await database.updateCustomer(customerId, payload || {}, user.id).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể cập nhật khách hàng."); });
        return { status: 200, json: updated };
      }

      if (pathname.startsWith("/api/admin/customers/") && req.method === "DELETE") {
        const user = await requireRole(req, "delete:customers", sessionStore, RequestError);
        const customerId = decodeURIComponent(pathname.replace("/api/admin/customers/", ""));
        const deleted = await database.softDeleteCustomer(customerId, user.id).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể xoá khách hàng."); });
        return { status: 200, json: { ok: deleted } };
      }

      if (pathname.startsWith("/api/admin/customers/") && pathname.includes("/interactions")) {
        const user = await requireRole(req, "read:customers", sessionStore, RequestError);
        const customerId = decodeURIComponent(pathname.split("/interactions")[0].replace("/api/admin/customers/", ""));
        if (req.method === "GET") {
          const interactions = await database.getCustomerInteractions(customerId, { page: 1, limit: 20 }).catch(() => []);
          return { status: 200, json: interactions };
        }
        if (req.method === "POST") {
          const payload = await parseJsonBody(req);
          const created = await database.createCustomerInteraction(customerId, payload || {}, user.id).catch((error) => { throw new RequestError(error.status || 400, error.message || "Không thể lưu tương tác."); });
          return { status: 201, json: created };
        }
      }

      return { status: 404, json: { error: "Đường dẫn không tồn tại." } };
    };

    runWithErrorHandling(req, res, routeHandler).catch((error) => {
      const status = error && typeof error.status === "number" ? error.status : 500;
      res.writeHead(status, {
        ...buildSecurityHeaders({ isProduction: isProductionEnvironment() }),
        "content-type": "application/json; charset=utf-8",
        "x-request-id": getRequestId(req),
      });
      res.end(jsonResponsePayload({ error: sanitizeErrorMessage(error, status) }));
    });
  });

  server.on("clientError", (error, socket) => {
    socket.destroy();
  });

  server.database = database;
  server.sessionStore = sessionStore;
  server.close = (callback) => {
    sessionStore.close();
    if (typeof database.close === "function") {
      return database.close(callback);
    }
    return http.Server.prototype.close.call(server, callback);
  };

  return server;
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return map[extension] || "application/octet-stream";
}

module.exports = { createServer };
