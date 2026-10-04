const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const books = require("./books-data");

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
const coupons = new Map([
  ["BOOKNEST10", { rate: 0.1, label: "Ưu đãi BookNest" }],
  ["WELCOME5", { rate: 0.05, label: "Ưu đãi chào mừng" }],
]);
const maxRequestBytes = 1024 * 1024;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
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

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Dữ liệu đơn hàng không hợp lệ.");
  }
}

function createOrder(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError(400, "Dữ liệu đơn hàng không hợp lệ.");
  }

  const customerName =
    typeof payload.customerName === "string" ? payload.customerName.trim() : "";
  const address =
    typeof payload.address === "string" ? payload.address.trim() : "";
  const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
  const paymentMethod = payload.paymentMethod;
  const discountRate = payload.discountRate;
  const couponCode = typeof payload.couponCode === "string" ? payload.couponCode.trim().toUpperCase() : "";

  if (customerName.length < 2 || customerName.length > 120) {
    throw new RequestError(400, "Vui lòng kiểm tra họ tên người nhận.");
  }
  if (address.length < 10 || address.length > 300) {
    throw new RequestError(400, "Vui lòng kiểm tra địa chỉ nhận hàng.");
  }
  if (!/^[0-9 +()-]{8,20}$/.test(phone)) {
    throw new RequestError(400, "Vui lòng kiểm tra số điện thoại.");
  }
  if (!["transfer", "cod"].includes(paymentMethod)) {
    throw new RequestError(400, "Phương thức thanh toán không hợp lệ.");
  }
  if (!allowedDiscountRates.has(discountRate)) {
    throw new RequestError(400, "Mức giảm giá không hợp lệ.");
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
    const book =
      item && typeof item.title === "string"
        ? bookCatalog.get(item.title)
        : null;
    if (
      !book ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    ) {
      throw new RequestError(
        400,
        "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.",
      );
    }
    quantities.set(
      book.title,
      (quantities.get(book.title) || 0) + item.quantity,
    );
    if (quantities.get(book.title) > 99) {
      throw new RequestError(
        400,
        "Số lượng mỗi tựa sách không được vượt quá 99.",
      );
    }
  }

  const orderItems = [...quantities].map(([title, quantity]) => {
    const book = bookCatalog.get(title);
    return {
      title: book.title,
      author: book.author,
      unitPrice: book.price,
      quantity,
      lineTotal: book.price * quantity,
    };
  });
  const subtotal = orderItems.reduce(
    (total, item) => total + item.lineTotal,
    0,
  );
  const couponRate = couponCode ? coupons.get(couponCode).rate : 0;
  const discount = Math.round(subtotal * Math.min(discountRate + couponRate, 0.3));

  return {
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
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    couponCode: order.couponCode,
    total: order.total,
    items: order.items.map(({ title, quantity, lineTotal }) => ({
      title,
      quantity,
      lineTotal,
    })),
  };
}

async function findOrder(ordersPath, orderId) {
  let contents;
  try {
    contents = await fs.readFile(ordersPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  for (const line of contents.split("\n")) {
    if (!line) continue;
    const order = JSON.parse(line);
    if (order.orderId === orderId) return order;
  }
  return null;
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
		'Cache-Control': 'no-cache',
		'Content-Length': contents.length,
		'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
		'X-Content-Type-Options': 'nosniff'
	});
	response.end(request.method === 'HEAD' ? undefined : contents);
}

function createServer({
  ordersPath = defaultOrdersPath,
  staticRoot = root,
} = {}) {
  let persistenceQueue = Promise.resolve();

  async function persistOrder(order) {
    await fs.mkdir(path.dirname(ordersPath), { recursive: true });
    const write = persistenceQueue.then(() =>
      fs.appendFile(ordersPath, `${JSON.stringify(order)}\n`, "utf8"),
    );
    persistenceQueue = write.then(
      () => undefined,
      () => undefined,
    );
    await write;
  }

  async function handleRequest(request, response) {
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname === "/api/orders" && request.method === "POST") {
      if (
        request.headers["content-type"]?.split(";")[0] !== "application/json"
      ) {
        throw new RequestError(415, "Đơn hàng cần được gửi ở định dạng JSON.");
      }

      const couponMatch = requestUrl.pathname.match(/^\/api\/coupons\/([A-Za-z0-9_-]+)$/);
      if (couponMatch && request.method === "GET") {
        const coupon = coupons.get(couponMatch[1].toUpperCase());
        if (!coupon) {
          sendJson(response, 404, { error: "Mã ưu đãi không hợp lệ hoặc đã hết hạn." });
          return;
        }
        sendJson(response, 200, coupon);
        return;
      }

      const order = createOrder(await readJson(request));
      await persistOrder(order);
      sendJson(response, 201, publicOrder(order));
      return;
    }

    const orderMatch = requestUrl.pathname.match(
      /^\/api\/orders\/([0-9a-f-]+)$/i,
    );
    if (orderMatch && request.method === "GET") {
      const order = await findOrder(ordersPath, orderMatch[1]);
      if (!order) {
        sendJson(response, 404, { error: "Không tìm thấy đơn hàng." });
        return;
      }
      sendJson(response, 200, publicOrder(order));
      return;
    }

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

  return http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("Không thể xử lý yêu cầu:", error);
      if (!response.headersSent) {
        void sendHtmlError(response, 500, "500");
        return;
      }
      response.destroy(error);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || "127.0.0.1";
  createServer().listen(port, host, () => {
    console.log(`BookNest đang chạy tại http://${host}:${port}`);
  });
}

module.exports = { createServer };
