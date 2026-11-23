"use strict";

const crypto = require("node:crypto");

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
  STATE_CHANGING_METHODS,
  createCsrfToken,
  parseCookies,
  validateCsrfRequest,
};
