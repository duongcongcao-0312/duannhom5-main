"use strict";

const crypto = require("node:crypto");

const SESSION_COOKIE_NAME = "bn_session";
const CSRF_COOKIE_NAME = "bn_csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_ROUTES = new Set([
  "/api/payments/webhook",
  "/api/payments/sepay-webhook",
]);

function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isSecureRequest(request) {
  if (request?.socket?.encrypted === true) return true;
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    return true;
  }
  return forwardedProto === "https";
}

function resolveSessionSameSite(isSecure) {
  const configured = String(process.env.SESSION_COOKIE_SAMESITE || "Lax").trim().toLowerCase();
  if (configured === "strict") return "Strict";
  if (configured === "none" && isSecure) return "None";
  return "Lax";
}

function buildAuthCookieHeaders(request, { sessionToken, expiresAt, csrfToken = createCsrfToken() }) {
  const isSecure = isSecureRequest(request);
  const sameSite = resolveSessionSameSite(isSecure);
  const maxAgeSeconds = Number.isFinite(expiresAt)
    ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))
    : 7 * 24 * 60 * 60;
  const secureFlag = isSecure ? "; Secure" : "";
  return [
    `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secureFlag}`,
    `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secureFlag}`,
  ];
}

function buildClearAuthCookieHeaders(request) {
  const isSecure = isSecureRequest(request);
  const sameSite = resolveSessionSameSite(isSecure);
  const secureFlag = isSecure ? "; Secure" : "";
  return [
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secureFlag}`,
    `${CSRF_COOKIE_NAME}=; Path=/; SameSite=${sameSite}; Max-Age=0${secureFlag}`,
  ];
}

function extractSessionToken(request) {
  const authHeader = String(request?.headers?.authorization || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1].trim()) {
    return bearerMatch[1].trim();
  }
  const cookies = parseCookies(request?.headers?.cookie);
  return typeof cookies[SESSION_COOKIE_NAME] === "string"
    ? cookies[SESSION_COOKIE_NAME].trim()
    : "";
}

function parseCookies(cookieHeader) {
  const cookies = Object.create(null);
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) continue;
    cookies[name] = value;
  }
  return cookies;
}

function timingSafeTextEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function getTrustedOriginsForRequest(request, allowedOrigins) {
  const trusted = new Set(allowedOrigins || []);
  const host = String(request?.headers?.host || "").trim();
  if (host && !/[\s/\\]/.test(host)) {
    trusted.add(`http://${host}`);
    trusted.add(`https://${host}`);
  }
  return trusted;
}

function validateCsrfRequest(request, canonicalPath, allowedOrigins = new Set()) {
  const method = String(request?.method || "GET").toUpperCase();
  if (!canonicalPath || !canonicalPath.startsWith("/api/")) {
    return { ok: true };
  }
  if (!STATE_CHANGING_METHODS.has(method)) {
    return { ok: true };
  }
  if (CSRF_EXEMPT_ROUTES.has(canonicalPath)) {
    return { ok: true };
  }

  const headers = request?.headers || {};
  const trustedOrigins = getTrustedOriginsForRequest(request, allowedOrigins);
  const rawOrigin = typeof headers.origin === "string" ? headers.origin.trim() : "";
  const rawReferer = typeof headers.referer === "string" ? headers.referer.trim() : "";
  const secFetchSite = typeof headers["sec-fetch-site"] === "string"
    ? headers["sec-fetch-site"].trim().toLowerCase()
    : "";

  if (rawOrigin) {
    if (rawOrigin.toLowerCase() === "null" || !trustedOrigins.has(rawOrigin)) {
      return {
        ok: false,
        errorCode: "CSRF_ORIGIN_FORBIDDEN",
        message: "Yêu cầu bị từ chối do nguồn gốc (Origin) không được phép.",
      };
    }
  } else if (rawReferer) {
    let refererOrigin = "";
    try {
      refererOrigin = new URL(rawReferer).origin;
    } catch {
      refererOrigin = "";
    }
    if (!refererOrigin || refererOrigin === "null" || !trustedOrigins.has(refererOrigin)) {
      return {
        ok: false,
        errorCode: "CSRF_ORIGIN_FORBIDDEN",
        message: "Yêu cầu bị từ chối do nguồn gốc (Referer) không được phép.",
      };
    }
  }

  if (secFetchSite === "cross-site") {
    if (!rawOrigin || !allowedOrigins.has(rawOrigin)) {
      return {
        ok: false,
        errorCode: "CSRF_CROSS_SITE_FORBIDDEN",
        message: "Yêu cầu cross-site bị từ chối vì lý do bảo mật CSRF.",
      };
    }
  }

  const rawCookie = typeof headers.cookie === "string" ? headers.cookie : "";
  if (rawCookie.trim()) {
    const cookies = parseCookies(rawCookie);
    const hasBearerAuth = /^Bearer\s+\S+/i.test(String(headers.authorization || "").trim());
    const cookieToken = cookies[CSRF_COOKIE_NAME] || "";
    if (!hasBearerAuth || cookieToken) {
      const headerToken = typeof headers[CSRF_HEADER_NAME] === "string"
        ? headers[CSRF_HEADER_NAME].trim()
        : "";
      if (
        cookieToken.length < 32 ||
        !timingSafeTextEqual(cookieToken, headerToken)
      ) {
        return {
          ok: false,
          errorCode: "CSRF_TOKEN_INVALID",
          message: "Thiếu hoặc sai mã bảo vệ CSRF (X-CSRF-Token).",
        };
      }
    }
  }

  return { ok: true };
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_EXEMPT_ROUTES,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  STATE_CHANGING_METHODS,
  buildAuthCookieHeaders,
  buildClearAuthCookieHeaders,
  createCsrfToken,
  extractSessionToken,
  parseCookies,
  validateCsrfRequest,
};
