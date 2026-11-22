"use strict";

const { randomUUID } = require("node:crypto");

const DEFAULT_ERROR_CODES = Object.freeze({
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  414: "URI_TOO_LONG",
  415: "UNSUPPORTED_MEDIA_TYPE",
  428: "PRECONDITION_REQUIRED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
});

const GENERIC_SERVER_ERROR_MESSAGE =
  "Máy chủ gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.";
const GENERIC_CLIENT_ERROR_MESSAGE =
  "Không thể xử lý yêu cầu. Vui lòng kiểm tra dữ liệu và thử lại.";

const API_ERROR_POLICY = Object.freeze({
  schemaFields: Object.freeze(["error", "code", "requestId"]),
  optionalFields: Object.freeze(["details", "maxBytes"]),
  correlationHeader: "X-Request-Id",
  exposeStackTraces: false,
  exposeInternalDetails: false,
  defaultCodes: DEFAULT_ERROR_CODES,
});

const SENSITIVE_OR_INTERNAL_PATTERNS = [
  /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
  /\b(?:relation|column|constraint|duplicate key value|syntax error at or near|pg_catalog|SQLITE_)\b/i,
  /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EACCES|ENOENT|EPERM)\b/,
  /\bat\s+[A-Za-z0-9_$.<>]+\s+\([^)]+:\d+:\d+\)/,
  /(?:[A-Za-z]:\\(?:Users|Windows|Program Files|var|etc|home)|\/(?:etc|var|usr|home|root|tmp)\/)[^\s"']+/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s]+/i,
  /BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY/i,
  /\b(?:Bearer|Apikey)\s+[A-Za-z0-9._~+/-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /\b(?:\+84|0)(?:3|5|7|8|9)\d{8}\b/,
];

function containsSensitiveOrInternalDetail(text) {
  if (typeof text !== "string" || !text) return false;
  return SENSITIVE_OR_INTERNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function resolveCorrelationId(request) {
  const suppliedId = request?.headers?.["x-request-id"];
  if (
    typeof suppliedId !== "string" ||
    suppliedId.length === 0 ||
    suppliedId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(suppliedId)
  ) {
    return randomUUID();
  }
  const authHeader = String(request?.headers?.authorization || "");
  const bearerToken = authHeader.replace(/^(?:Bearer|Apikey)\s+/i, "").trim();
  const orderAccessCode = String(request?.headers?.["x-order-access-code"] || "").trim();
  const exportToken = String(request?.headers?.["x-export-token"] || "").trim();
  const signature = String(request?.headers?.["x-booknest-signature"] || "").trim();

  if (
    (bearerToken && suppliedId === bearerToken) ||
    (orderAccessCode && suppliedId === orderAccessCode) ||
    (exportToken && suppliedId === exportToken) ||
    (signature && suppliedId === signature) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(suppliedId)
  ) {
    return randomUUID();
  }
  return suppliedId;
}

function normalizeErrorStatus(error, isExpectedError) {
  if (
    isExpectedError &&
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    return error.status;
  }
  return 500;
}

function resolveErrorCode(status, error, isExpectedError) {
  if (
    isExpectedError &&
    status < 500 &&
    typeof error?.errorCode === "string" &&
    /^[A-Z0-9_]{2,64}$/.test(error.errorCode)
  ) {
    return error.errorCode;
  }
  return DEFAULT_ERROR_CODES[status] || (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
}

function sanitizeClientErrorMessage(rawMessage, status, isExpectedError) {
  if (status >= 500) {
    if (
      status === 503 &&
      isExpectedError &&
      typeof rawMessage === "string" &&
      rawMessage.trim() &&
      !containsSensitiveOrInternalDetail(rawMessage)
    ) {
      return rawMessage.trim();
    }
    return GENERIC_SERVER_ERROR_MESSAGE;
  }
  if (
    !isExpectedError ||
    typeof rawMessage !== "string" ||
    !rawMessage.trim() ||
    containsSensitiveOrInternalDetail(rawMessage)
  ) {
    return GENERIC_CLIENT_ERROR_MESSAGE;
  }
  return rawMessage.trim();
}

function buildApiErrorPayload({
  error,
  status,
  isExpectedError = false,
  requestId,
}) {
  const effectiveStatus = Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : normalizeErrorStatus(error, isExpectedError);
  const message = sanitizeClientErrorMessage(error?.message, effectiveStatus, isExpectedError);
  const code = resolveErrorCode(effectiveStatus, error, isExpectedError);
  const payload = {
    error: message,
    code,
    ...(requestId ? { requestId } : {}),
  };

  if (isExpectedError && Number.isSafeInteger(error?.maxBytes) && error.maxBytes > 0) {
    payload.maxBytes = error.maxBytes;
  }
  if (
    isExpectedError &&
    effectiveStatus === 400 &&
    Array.isArray(error?.details) &&
    error.details.length > 0
  ) {
    payload.details = error.details.map((item) => ({
      field: String(item?.field || "$root"),
      reason: String(item?.reason || "invalid"),
    }));
  }

  return { status: effectiveStatus, payload };
}

module.exports = {
  API_ERROR_POLICY,
  DEFAULT_ERROR_CODES,
  GENERIC_CLIENT_ERROR_MESSAGE,
  GENERIC_SERVER_ERROR_MESSAGE,
  buildApiErrorPayload,
  containsSensitiveOrInternalDetail,
  normalizeErrorStatus,
  resolveCorrelationId,
  resolveErrorCode,
  sanitizeClientErrorMessage,
};
