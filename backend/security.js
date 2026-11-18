"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

/*============================================================================
  CSRF PROTECTION
============================================================================*/

const CSRF_TOKEN_LENGTH = 32;
const csrfTokens = new Map(); // token -> { expiresAt, userId }

function generateCsrfToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

function createCsrfToken(userId, ttlMs = 10 * 60 * 1000) {
  const token = generateCsrfToken();
  csrfTokens.set(token, {
    expiresAt: Date.now() + ttlMs,
    userId,
  });
  return token;
}

function verifyCsrfToken(token, userId) {
  if (!token || typeof token !== "string") return false;
  const record = csrfTokens.get(token);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    csrfTokens.delete(token);
    return false;
  }
  if (record.userId !== userId) return false;
  csrfTokens.delete(token); // single-use
  return true;
}

function cleanupCsrfTokens() {
  const now = Date.now();
  for (const [token, record] of csrfTokens) {
    if (now > record.expiresAt) csrfTokens.delete(token);
  }
}
setInterval(cleanupCsrfTokens, 5 * 60 * 1000).unref?.();

/*============================================================================
  SHARED RATE LIMITER (file-backed for multi-process safety)
============================================================================*/

const RATE_LIMIT_DIR = path.join(__dirname, "..", "data", "rate-limit");
const RATE_LIMIT_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

async function rateLimitFilePath(identifier, directory = RATE_LIMIT_DIR) {
  await fs.mkdir(directory, { recursive: true });
  const safe = String(identifier).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(directory, `${safe}.json`);
}

async function readRateLimitRecord(identifier, directory) {
  const filePath = await rateLimitFilePath(identifier, directory);
  try {
    const content = await fs.readFile(filePath, "utf8");
    const record = JSON.parse(content);
    if (record && typeof record === "object" && Number.isFinite(record.expiresAt)) {
      return record;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

async function writeRateLimitRecord(identifier, record, directory) {
  const filePath = await rateLimitFilePath(identifier, directory);
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record), "utf8");
  await fs.rename(tmp, filePath).catch(async (error) => {
    if (process.platform === "win32" && (error.code === "EPERM" || error.code === "EEXIST")) {
      await fs.rm(filePath, { force: true }).catch(() => {});
      await fs.rename(tmp, filePath);
    } else {
      throw error;
    }
  });
}

async function incrementRateLimit(
  identifier,
  limit,
  windowMs = RATE_LIMIT_TTL_MS,
  now = Date.now(),
  directory = RATE_LIMIT_DIR,
) {
  let record = await readRateLimitRecord(identifier, directory);
  if (!record || now > record.expiresAt) {
    record = { count: 1, expiresAt: now + windowMs };
  } else {
    record.count += 1;
    record.expiresAt = record.expiresAt || now + windowMs;
  }
  await writeRateLimitRecord(identifier, record, directory);
  return { count: record.count, limit, remaining: Math.max(0, limit - record.count), resetAt: record.expiresAt };
}

async function checkRateLimit(
  identifier,
  limit,
  windowMs = RATE_LIMIT_TTL_MS,
  now = Date.now(),
  directory = RATE_LIMIT_DIR,
) {
  const result = await incrementRateLimit(identifier, limit, windowMs, now, directory);
  if (result.count > limit) {
    return { allowed: false, ...result };
  }
  return { allowed: true, ...result };
}

async function clearRateLimit(identifier, directory = RATE_LIMIT_DIR) {
  const filePath = await rateLimitFilePath(identifier, directory);
  await fs.rm(filePath, { force: true });
}

async function cleanupRateLimitFiles(directory = RATE_LIMIT_DIR) {
  await fs.mkdir(directory, { recursive: true });
  try {
    const files = await fs.readdir(directory);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(directory, file), "utf8");
        const record = JSON.parse(content);
        if (record && Number.isFinite(record.expiresAt) && now > record.expiresAt) {
          await fs.rm(path.join(directory, file), { force: true });
        }
      } catch {
        // ignore corrupt files
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
setInterval(cleanupRateLimitFiles, RATE_LIMIT_CLEANUP_INTERVAL_MS).unref?.();

function parseTrustedProxyIps(value) {
  let entries;
  if (Array.isArray(value)) {
    entries = value;
  } else if (value === undefined || value === null || value === "") {
    entries = [];
  } else if (typeof value === "string") {
    entries = value.split(",");
  } else {
    throw new RangeError("RATE_LIMIT_TRUSTED_PROXY_IPS must be a comma-separated IP list.");
  }
  const addresses = entries.map((entry) => (
    typeof entry === "string" ? entry.trim() : ""
  ));
  if (addresses.some((address) => !address || net.isIP(address) === 0)) {
    throw new RangeError("RATE_LIMIT_TRUSTED_PROXY_IPS must contain only valid IP addresses.");
  }
  return [...new Set(addresses)];
}

function getClientAddress(request, trustedProxyHops = 0, trustedProxyIps = []) {
  const remoteAddress = typeof request?.socket?.remoteAddress === "string" &&
    net.isIP(request.socket.remoteAddress)
    ? request.socket.remoteAddress
    : "unknown";
  const trustedPeer = Array.isArray(trustedProxyIps) && trustedProxyIps.some(
    (address) => typeof address === "string" &&
      address.toLowerCase() === remoteAddress.toLowerCase(),
  );
  if (
    !Number.isSafeInteger(trustedProxyHops) ||
    trustedProxyHops <= 0 ||
    !trustedPeer
  ) {
    return remoteAddress;
  }
  const forwardedFor = request?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor !== "string" || forwardedFor.length > 1024) {
    return remoteAddress;
  }
  const addresses = forwardedFor.split(",").map((address) => address.trim());
  if (addresses.length === 0 || addresses.some((address) => net.isIP(address) === 0)) {
    return remoteAddress;
  }
  return addresses[Math.max(0, addresses.length - trustedProxyHops)] || remoteAddress;
}

function createRateLimitBucketKey(secret, scope, identity) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new RangeError("RATE_LIMIT_HMAC_KEY must contain at least 32 bytes.");
  }
  if (typeof scope !== "string" || !scope.trim()) {
    throw new TypeError("Rate-limit scope is required.");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${scope}\u0000${String(identity)}`)
    .digest("hex");
}

/*============================================================================
  INPUT SANITIZATION & VALIDATION
============================================================================*/

const DANGEROUS_CHARS = /[<>'"&`]/g;
const HTML_ESCAPE_MAP = {
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;",
  "&": "&amp;",
};

function escapeHtml(value) {
  if (typeof value !== "string") return value;
  return value.replace(DANGEROUS_CHARS, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

function sanitizePlainText(value, maxLength = 1000) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return str.slice(0, maxLength);
}

function validateEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
}

function validateUuid(value) {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validateObjectId(value) {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{24}$/i.test(value);
}

/*============================================================================
  SECURE PASSWORD RESET TOKEN
============================================================================*/

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString("hex"); // 256-bit token
}

function hashPasswordResetToken(token) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + ":" + token).digest("hex");
  return `${salt}:${hash}`;
}

// Session and refresh tokens are high-entropy random values. A deterministic
// digest is required so the database can look them up without storing them raw.
function secureHashPasswordResetToken(token) {
  if (typeof token !== "string" || !token) {
    throw new TypeError("A non-empty token is required.");
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function verifyPasswordResetToken(token, stored) {
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token) ||
    typeof stored !== "string" ||
    !stored.includes(":")
  ) return false;
  const [salt, hash] = stored.split(":");
  if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  const computed = crypto.createHash("sha256").update(salt + ":" + token).digest();
  const supplied = Buffer.from(hash, "hex");
  return supplied.length === computed.length && crypto.timingSafeEqual(supplied, computed);
}

/*============================================================================
  SECURITY HEADERS BUILDER
============================================================================*/

function buildSecurityHeaders({ isProduction = false } = {}) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://www.gstatic.com https://www.google.com https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
    "frame-src https://*.firebaseapp.com https://accounts.google.com",
  ].join("; ");

  const headers = {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };

  if (isProduction) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
    headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
  }

  return headers;
}

/*============================================================================
  CORS VALIDATION
============================================================================*/

function parseCorsOrigins(corsOriginsEnv) {
  if (!corsOriginsEnv) return new Set();
  return new Set(
    String(corsOriginsEnv)
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
}

function isOriginAllowed(origin, allowedOrigins, isProduction = false) {
  if (!origin) return false;
  if (allowedOrigins.has("*") && !isProduction) return true;
  if (allowedOrigins.has(origin)) return true;
  if (!isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (!isProduction && /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  return false;
}

/*============================================================================
  ERROR SANITIZATION
============================================================================*/

function sanitizeErrorMessage(error, statusCode) {
  if (statusCode >= 500) {
    return "Máy chủ gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Lỗi xử lý yêu cầu.";
}

module.exports = {
  CSRF_TOKEN_LENGTH,
  RATE_LIMIT_TTL_MS,
  generateCsrfToken,
  createCsrfToken,
  verifyCsrfToken,
  cleanupCsrfTokens,
  incrementRateLimit,
  checkRateLimit,
  clearRateLimit,
  cleanupRateLimitFiles,
  parseTrustedProxyIps,
  getClientAddress,
  createRateLimitBucketKey,
  escapeHtml,
  sanitizePlainText,
  validateEmail,
  validateUuid,
  validateObjectId,
  generatePasswordResetToken,
  hashPasswordResetToken,
  secureHashPasswordResetToken,
  verifyPasswordResetToken,
  buildSecurityHeaders,
  parseCorsOrigins,
  isOriginAllowed,
  sanitizeErrorMessage,
};
