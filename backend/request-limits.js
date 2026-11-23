"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { resolveApiVersion } = require("./api-versioning");

const MAX_URL_LENGTH = 2048;

const ENDPOINT_BODY_LIMITS = Object.freeze({
  auth: 16 * 1024, // 16 KiB — login, register, password reset, profile, student verification
  webhooks: 32 * 1024, // 32 KiB — payment & SePay webhooks
  services: 32 * 1024, // 32 KiB — service bookings
  privacy: 32 * 1024, // 32 KiB — privacy consent & DSAR requests
  orders: 64 * 1024, // 64 KiB — order quotes, checkout, order updates
  customers: 64 * 1024, // 64 KiB — CRM customers & interactions
  admin: 128 * 1024, // 128 KiB — admin catalog/staff/coupon/order management
  upload: 2 * 1024 * 1024, // 2 MiB — binary image upload payload
  default: 64 * 1024, // 64 KiB — fallback API limit
});

const MULTIPART_OVERHEAD_BYTES = 64 * 1024; // 64 KiB for multipart boundaries & headers
const MAX_MULTIPART_HEADER_BYTES = 4 * 1024;

const UPLOAD_POLICY = Object.freeze({
  maxFileBytes: ENDPOINT_BODY_LIMITS.upload,
  multipartOverheadBytes: MULTIPART_OVERHEAD_BYTES,
  maxFilenameLength: 120,
  allowedMimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  canonicalExtensions: Object.freeze({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  }),
  allowedExtensionsByMime: Object.freeze({
    "image/jpeg": Object.freeze([".jpg", ".jpeg"]),
    "image/png": Object.freeze([".png"]),
    "image/webp": Object.freeze([".webp"]),
  }),
  dangerousExtensions: new Set([
    ".svg",
    ".svgz",
    ".html",
    ".htm",
    ".xhtml",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".php",
    ".phtml",
    ".asp",
    ".aspx",
    ".jsp",
    ".exe",
    ".dll",
    ".bat",
    ".cmd",
    ".sh",
    ".ps1",
    ".py",
    ".rb",
    ".pl",
    ".jar",
    ".war",
    ".swf",
    ".xml",
  ]),
  storageFilenamePattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.(?:jpg|png)|(?:-(?:320|640))?\.webp)$/,
});

const REQUEST_LIMIT_POLICY = Object.freeze({
  maxUrlLength: MAX_URL_LENGTH,
  endpointBodyLimits: ENDPOINT_BODY_LIMITS,
  upload: UPLOAD_POLICY,
});

class RequestLimitError extends Error {
  constructor(status, message, { errorCode, maxBytes, category } = {}) {
    super(message);
    this.name = "RequestLimitError";
    this.status = status;
    if (errorCode) this.errorCode = errorCode;
    if (Number.isSafeInteger(maxBytes)) this.maxBytes = maxBytes;
    if (category) this.category = category;
  }
}

function normalizePositiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function resolveRequestBodyLimit(pathname, { contentType = "", overrides = {} } = {}) {
  const versionInfo = resolveApiVersion(typeof pathname === "string" ? pathname : "/");
  const safePath = versionInfo.canonicalPath;
  const normalizedContentType = String(contentType || "").split(";")[0].trim().toLowerCase();

  const limits = {
    auth: normalizePositiveLimit(overrides.auth, ENDPOINT_BODY_LIMITS.auth),
    webhooks: normalizePositiveLimit(overrides.webhooks, ENDPOINT_BODY_LIMITS.webhooks),
    services: normalizePositiveLimit(overrides.services, ENDPOINT_BODY_LIMITS.services),
    privacy: normalizePositiveLimit(overrides.privacy, ENDPOINT_BODY_LIMITS.privacy),
    orders: normalizePositiveLimit(overrides.orders, ENDPOINT_BODY_LIMITS.orders),
    customers: normalizePositiveLimit(overrides.customers, ENDPOINT_BODY_LIMITS.customers),
    admin: normalizePositiveLimit(overrides.admin, ENDPOINT_BODY_LIMITS.admin),
    upload: normalizePositiveLimit(overrides.upload, ENDPOINT_BODY_LIMITS.upload),
    default: normalizePositiveLimit(overrides.default, ENDPOINT_BODY_LIMITS.default),
  };

  if (safePath.startsWith("/api/admin/uploads/")) {
    const isMultipart = normalizedContentType === "multipart/form-data";
    return {
      category: "upload",
      maxFileBytes: limits.upload,
      maxBytes: isMultipart ? limits.upload + MULTIPART_OVERHEAD_BYTES : limits.upload,
    };
  }
  if (safePath.startsWith("/api/auth/")) {
    return { category: "auth", maxBytes: limits.auth };
  }
  if (safePath === "/api/payments/webhook" || safePath === "/api/payments/sepay-webhook") {
    return { category: "webhooks", maxBytes: limits.webhooks };
  }
  if (safePath === "/api/services" || safePath.startsWith("/api/services/")) {
    return { category: "services", maxBytes: limits.services };
  }
  if (safePath.startsWith("/api/privacy/")) {
    return { category: "privacy", maxBytes: limits.privacy };
  }
  if (safePath === "/api/orders" || safePath.startsWith("/api/orders/")) {
    return { category: "orders", maxBytes: limits.orders };
  }
  if (
    safePath === "/api/customers" ||
    safePath.startsWith("/api/customers/") ||
    safePath === "/api/admin/customers" ||
    safePath.startsWith("/api/admin/customers/")
  ) {
    return { category: "customers", maxBytes: limits.customers };
  }
  if (safePath.startsWith("/api/admin/")) {
    return { category: "admin", maxBytes: limits.admin };
  }
  return { category: "default", maxBytes: limits.default };
}

function parseContentLengthHeader(rawHeader) {
  if (rawHeader === undefined || rawHeader === null || rawHeader === "") {
    return null;
  }
  if (Array.isArray(rawHeader)) {
    throw new RequestLimitError(400, "Header Content-Length không hợp lệ.", {
      errorCode: "INVALID_CONTENT_LENGTH",
    });
  }
  const trimmed = String(rawHeader).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new RequestLimitError(400, "Header Content-Length không hợp lệ.", {
      errorCode: "INVALID_CONTENT_LENGTH",
    });
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RequestLimitError(400, "Header Content-Length không hợp lệ.", {
      errorCode: "INVALID_CONTENT_LENGTH",
    });
  }
  return parsed;
}

function assertRequestSizeHeaders(request, pathname, overrides = {}) {
  const rawUrl = typeof request?.url === "string" ? request.url : "";
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new RequestLimitError(414, "Đường dẫn yêu cầu quá dài.", {
      errorCode: "URI_TOO_LONG",
      maxBytes: MAX_URL_LENGTH,
    });
  }

  const contentType = request?.headers?.["content-type"] || "";
  const limit = resolveRequestBodyLimit(pathname, { contentType, overrides });
  const contentLength = parseContentLengthHeader(request?.headers?.["content-length"]);

  if (contentLength !== null && contentLength > limit.maxBytes) {
    throw new RequestLimitError(413, "Yêu cầu quá lớn.", {
      errorCode: "PAYLOAD_TOO_LARGE",
      maxBytes: limit.maxBytes,
      category: limit.category,
    });
  }

  return { limit, contentLength };
}

async function readBoundedBody(request, maxBytes, { category } = {}) {
  const effectiveMax = normalizePositiveLimit(maxBytes, ENDPOINT_BODY_LIMITS.default);
  const contentLength = parseContentLengthHeader(request?.headers?.["content-length"]);
  if (contentLength !== null && contentLength > effectiveMax) {
    throw new RequestLimitError(413, "Yêu cầu quá lớn.", {
      errorCode: "PAYLOAD_TOO_LARGE",
      maxBytes: effectiveMax,
      category,
    });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bufferChunk.length;
    if (size > effectiveMax) {
      if (typeof request.pause === "function") {
        request.pause();
      }
      throw new RequestLimitError(413, "Yêu cầu quá lớn.", {
        errorCode: "PAYLOAD_TOO_LARGE",
        maxBytes: effectiveMax,
        category,
      });
    }
    chunks.push(bufferChunk);
  }
  return Buffer.concat(chunks, size);
}

function detectImageMimeFromMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function validateUploadFilename(filename, expectedMime) {
  if (filename === undefined || filename === null || filename === "") {
    return null;
  }
  if (typeof filename !== "string") {
    throw new RequestLimitError(400, "Tên tệp tải lên không hợp lệ.", {
      errorCode: "INVALID_UPLOAD_FILENAME",
    });
  }
  const trimmed = filename.trim();
  if (
    !trimmed ||
    trimmed.length > UPLOAD_POLICY.maxFilenameLength ||
    /[\u0000-\u001F\u007F]/.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".")
  ) {
    throw new RequestLimitError(400, "Tên tệp tải lên không hợp lệ hoặc chứa ký tự không an toàn.", {
      errorCode: "INVALID_UPLOAD_FILENAME",
    });
  }

  const segments = trimmed.split(".");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
    throw new RequestLimitError(400, "Tên tệp tải lên phải có phần mở rộng hợp lệ.", {
      errorCode: "INVALID_UPLOAD_FILENAME",
    });
  }

  const extension = `.${segments[segments.length - 1].toLowerCase()}`;
  const allowedExtensions = UPLOAD_POLICY.allowedExtensionsByMime[expectedMime] || [];
  if (!allowedExtensions.includes(extension)) {
    throw new RequestLimitError(400, "Phần mở rộng tệp không khớp với định dạng ảnh cho phép.", {
      errorCode: "INVALID_UPLOAD_FILENAME",
    });
  }

  // Block double extensions carrying executable or active-content types (e.g. shell.php.png, xss.svg.jpg)
  for (let i = 1; i < segments.length - 1; i += 1) {
    const intermediateExt = `.${segments[i].toLowerCase()}`;
    if (UPLOAD_POLICY.dangerousExtensions.has(intermediateExt)) {
      throw new RequestLimitError(400, "Tên tệp tải lên chứa phần mở rộng không được phép.", {
        errorCode: "INVALID_UPLOAD_FILENAME",
      });
    }
  }

  return trimmed;
}

function parseMultipartSingleFile(rawBody, contentTypeHeader, maxFileBytes = UPLOAD_POLICY.maxFileBytes) {
  const boundaryMatch = String(contentTypeHeader || "").match(/;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary || /[\r\n]/.test(boundary)) {
    throw new RequestLimitError(400, "Header multipart/form-data thiếu boundary hợp lệ.", {
      errorCode: "INVALID_MULTIPART",
    });
  }

  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const headerSeparator = Buffer.from("\r\n\r\n", "utf8");
  const parts = [];
  let searchOffset = rawBody.indexOf(delimiter);
  if (searchOffset === -1) {
    throw new RequestLimitError(400, "Nội dung multipart/form-data không hợp lệ.", {
      errorCode: "INVALID_MULTIPART",
    });
  }

  while (searchOffset !== -1) {
    const afterDelimiter = searchOffset + delimiter.length;
    if (rawBody.subarray(afterDelimiter, afterDelimiter + 2).toString("utf8") === "--") {
      break;
    }
    const partStart = rawBody.subarray(afterDelimiter, afterDelimiter + 2).toString("utf8") === "\r\n"
      ? afterDelimiter + 2
      : afterDelimiter;
    const nextDelimiter = rawBody.indexOf(delimiter, partStart);
    if (nextDelimiter === -1) {
      throw new RequestLimitError(400, "Nội dung multipart/form-data không hoàn chỉnh.", {
        errorCode: "INVALID_MULTIPART",
      });
    }
    let partEnd = nextDelimiter;
    if (partEnd >= 2 && rawBody[partEnd - 2] === 0x0d && rawBody[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    }
    parts.push(rawBody.subarray(partStart, partEnd));
    if (parts.length > 5) {
      throw new RequestLimitError(400, "Yêu cầu tải lên chứa quá nhiều trường.", {
        errorCode: "INVALID_MULTIPART",
      });
    }
    searchOffset = nextDelimiter;
  }

  let filePart = null;
  for (const part of parts) {
    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd === -1 || headerEnd > MAX_MULTIPART_HEADER_BYTES) {
      throw new RequestLimitError(400, "Header phần tải lên không hợp lệ.", {
        errorCode: "INVALID_MULTIPART",
      });
    }
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    const headers = new Map();
    for (const line of headerText.split("\r\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex <= 0) continue;
      headers.set(
        line.slice(0, colonIndex).trim().toLowerCase(),
        line.slice(colonIndex + 1).trim(),
      );
    }
    const disposition = headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/;\s*filename="([^"]*)"/i);
    if (!filenameMatch) continue;
    if (filePart) {
      throw new RequestLimitError(400, "Chỉ được tải lên tối đa 1 tệp mỗi yêu cầu.", {
        errorCode: "TOO_MANY_FILES",
      });
    }
    const buffer = part.subarray(headerEnd + headerSeparator.length);
    if (buffer.length > maxFileBytes) {
      throw new RequestLimitError(413, "Tệp tải lên vượt quá dung lượng cho phép.", {
        errorCode: "PAYLOAD_TOO_LARGE",
        maxBytes: maxFileBytes,
        category: "upload",
      });
    }
    filePart = {
      filename: filenameMatch[1],
      declaredMime: String(headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
      buffer,
    };
  }

  if (!filePart) {
    throw new RequestLimitError(400, "Không tìm thấy tệp tải lên trong yêu cầu.", {
      errorCode: "MISSING_UPLOAD_FILE",
    });
  }

  return filePart;
}

function validateImageUpload({
  buffer,
  declaredMime,
  filename = null,
  maxFileBytes = UPLOAD_POLICY.maxFileBytes,
}) {
  const normalizedMime = String(declaredMime || "").split(";")[0].trim().toLowerCase();
  if (!UPLOAD_POLICY.allowedMimeTypes.includes(normalizedMime)) {
    throw new RequestLimitError(415, "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận JPEG, PNG hoặc WebP.", {
      errorCode: "UNSUPPORTED_MEDIA_TYPE",
    });
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new RequestLimitError(400, "Tệp tải lên không được để trống.", {
      errorCode: "EMPTY_UPLOAD",
    });
  }

  if (buffer.length > maxFileBytes) {
    throw new RequestLimitError(413, "Tệp tải lên vượt quá dung lượng cho phép.", {
      errorCode: "PAYLOAD_TOO_LARGE",
      maxBytes: maxFileBytes,
      category: "upload",
    });
  }

  const detectedMime = detectImageMimeFromMagicBytes(buffer);
  if (!detectedMime || detectedMime !== normalizedMime) {
    throw new RequestLimitError(400, "Nội dung tệp không khớp với định dạng ảnh được phép (JPEG, PNG, WebP).", {
      errorCode: "INVALID_UPLOAD_CONTENT",
    });
  }

  const originalFilename = validateUploadFilename(filename, detectedMime);

  return {
    buffer,
    mimeType: detectedMime,
    extension: UPLOAD_POLICY.canonicalExtensions[detectedMime],
    size: buffer.length,
    originalFilename,
  };
}

async function storeSafeImageUpload(uploadsDir, validatedUpload) {
  const resolvedRoot = path.resolve(uploadsDir);
  await fs.mkdir(resolvedRoot, { recursive: true, mode: 0o700 });

  const imageId = crypto.randomUUID();
  const imageVariants = [
    { suffix: "", width: 1200, height: 1800 },
    { suffix: "-640", width: 640, height: 960 },
    { suffix: "-320", width: 320, height: 480 },
  ];
  const optimizedImages = [];
  try {
    for (const { suffix, width, height } of imageVariants) {
      optimizedImages.push({
        suffix,
        buffer: await sharp(validatedUpload.buffer, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize({ width, height, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer(),
      });
    }
  } catch {
    throw new RequestLimitError(400, "Không thể giải mã ảnh tải lên.", {
      errorCode: "INVALID_IMAGE_CONTENT",
    });
  }

  const storedPaths = [];
  try {
    for (const optimizedImage of optimizedImages) {
      const filename = `${imageId}${optimizedImage.suffix}.webp`;
      const targetPath = path.resolve(resolvedRoot, filename);
      if (
        !UPLOAD_POLICY.storageFilenamePattern.test(filename) ||
        !targetPath.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        throw new RequestLimitError(500, "Không thể tạo đường dẫn lưu trữ an toàn.");
      }
      await fs.writeFile(targetPath, optimizedImage.buffer, { flag: "wx", mode: 0o600 });
      storedPaths.push(targetPath);
    }
  } catch (error) {
    await Promise.all(storedPaths.map((filePath) => fs.unlink(filePath)));
    throw error;
  }

  const storageFilename = `${imageId}.webp`;
  const masterImage = optimizedImages[0].buffer;
  return {
    filename: storageFilename,
    originalFilename: validatedUpload.originalFilename,
    mimeType: "image/webp",
    size: masterImage.length,
    originalSize: validatedUpload.size,
    sha256: crypto.createHash("sha256").update(masterImage).digest("hex"),
    url: `/api/uploads/book-covers/${storageFilename}`,
    variants: {
      small: `/api/uploads/book-covers/${imageId}-320.webp`,
      medium: `/api/uploads/book-covers/${imageId}-640.webp`,
    },
  };
}

function resolveSafeStoredUploadPath(uploadsDir, filename) {
  if (typeof filename !== "string" || !UPLOAD_POLICY.storageFilenamePattern.test(filename)) {
    return null;
  }
  const resolvedRoot = path.resolve(uploadsDir);
  const filePath = path.resolve(resolvedRoot, filename);
  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  const extension = path.extname(filename).toLowerCase();
  const mimeType = extension === ".png"
    ? "image/png"
    : extension === ".jpg"
      ? "image/jpeg"
      : "image/webp";
  return { filePath, mimeType };
}

module.exports = {
  ENDPOINT_BODY_LIMITS,
  MAX_URL_LENGTH,
  MULTIPART_OVERHEAD_BYTES,
  REQUEST_LIMIT_POLICY,
  UPLOAD_POLICY,
  RequestLimitError,
  assertRequestSizeHeaders,
  detectImageMimeFromMagicBytes,
  parseContentLengthHeader,
  parseMultipartSingleFile,
  readBoundedBody,
  resolveRequestBodyLimit,
  resolveSafeStoredUploadPath,
  storeSafeImageUpload,
  validateImageUpload,
  validateUploadFilename,
};
