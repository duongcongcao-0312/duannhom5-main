"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
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

let rateLimitDirReady = (async () => {
  try {
    await fs.mkdir(RATE_LIMIT_DIR, { recursive: true });
  } catch {
    // ignore if exists
  }
})();

async function rateLimitFilePath(identifier) {
  const safe = String(identifier).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(RATE_LIMIT_DIR, `${safe}.json`);
}

async function readRateLimitRecord(identifier) {
  await rateLimitDirReady;
  const filePath = await rateLimitFilePath(identifier);
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

async function writeRateLimitRecord(identifier, record) {
  await rateLimitDirReady;
  const filePath = await rateLimitFilePath(identifier);
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

async function incrementRateLimit(identifier, limit, windowMs = RATE_LIMIT_TTL_MS) {
  const now = Date.now();
  let record = await readRateLimitRecord(identifier);
  if (!record || now > record.expiresAt) {
    record = { count: 1, expiresAt: now + windowMs };
  } else {
    record.count += 1;
    record.expiresAt = record.expiresAt || now + windowMs;
  }
  await writeRateLimitRecord(identifier, record);
  return { count: record.count, limit, remaining: Math.max(0, limit - record.count), resetAt: record.expiresAt };
}

async function checkRateLimit(identifier, limit, windowMs = RATE_LIMIT_TTL_MS) {
  const result = await incrementRateLimit(identifier, limit, windowMs);
  if (result.count > limit) {
    return { allowed: false, ...result };
  }
  return { allowed: true, ...result };
}

async function cleanupRateLimitFiles() {
  await rateLimitDirReady;
  try {
    const files = await fs.readdir(RATE_LIMIT_DIR);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(RATE_LIMIT_DIR, file), "utf8");
        const record = JSON.parse(content);
        if (record && Number.isFinite(record.expiresAt) && now > record.expiresAt) {
          await fs.rm(path.join(RATE_LIMIT_DIR, file), { force: true });
        }
      } catch {
        // ignore corrupt files
      }
    }
  } catch {
    // ignore if dir missing
  }
}
setInterval(cleanupRateLimitFiles, RATE_LIMIT_CLEANUP_INTERVAL_MS).unref?.();

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

function verifyPasswordResetToken(token, stored) {
  if (!token || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = crypto.createHash("sha256").update(salt + ":" + token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"));
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
  cleanupRateLimitFiles,
  escapeHtml,
  sanitizePlainText,
  validateEmail,
  validateUuid,
  validateObjectId,
  generatePasswordResetToken,
  hashPasswordResetToken,
  verifyPasswordResetToken,
  buildSecurityHeaders,
  parseCorsOrigins,
  isOriginAllowed,
  sanitizeErrorMessage,
};