"use strict";

/**
 * Self-service personal data update policy (BN-196 / issue #272).
 *
 * - SELF_SERVICE_FIELDS: the account owner may change these directly.
 * - CONFIRMATION_REQUIRED_FIELDS: replacing an existing value is an
 *   important change and needs re-authentication (password, or a recent
 *   login for social-only accounts).
 * - VERIFICATION_REQUIRED_FIELDS: cannot be changed through self-service;
 *   they need an additional verification process.
 *
 * Existing orders keep the delivery snapshot captured at checkout. Profile
 * changes only apply to future orders.
 */

const SELF_SERVICE_FIELDS = Object.freeze(["customerName", "name", "phone", "address"]);
const CONFIRMATION_REQUIRED_FIELDS = Object.freeze(["phone"]);
const CONFIRMATION_FIELDS = Object.freeze(["currentPassword"]);
const RECENT_LOGIN_WINDOW_MS = 10 * 60 * 1000;

const STUDENT_MESSAGE =
  "Thông tin học sinh/sinh viên cần được xác minh lại. Vui lòng liên hệ hỗ trợ kèm giấy tờ chứng minh.";
const VERIFICATION_REQUIRED_FIELDS = Object.freeze({
  email:
    "Email đăng nhập chỉ được thay đổi qua bộ phận hỗ trợ sau khi xác minh quyền sở hữu email mới.",
  password: "Vui lòng dùng chức năng khôi phục mật khẩu để đổi mật khẩu.",
  studentType: STUDENT_MESSAGE,
  studentId: STUDENT_MESSAGE,
  studentVerification: STUDENT_MESSAGE,
  role: "Không thể tự thay đổi vai trò tài khoản.",
  isActive: "Không thể tự thay đổi trạng thái tài khoản.",
  authProvider: "Vui lòng dùng chức năng liên kết/tách tài khoản social.",
  providerId: "Vui lòng dùng chức năng liên kết/tách tài khoản social.",
  userId: "Không thể cập nhật dữ liệu của tài khoản khác.",
  id: "Không thể cập nhật dữ liệu của tài khoản khác.",
});

class ProfileUpdateError extends Error {
  constructor(status, message, errorCode) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function validateField(field, value) {
  const invalid = (message) => new ProfileUpdateError(400, message, "INVALID_FIELD");
  if (field === "customerName") {
    if (value !== "" && (value.length < 2 || value.length > 120)) {
      throw invalid("Họ tên người nhận phải có từ 2 đến 120 ký tự.");
    }
    return value;
  }
  if (field === "name") {
    if (value.length < 2 || value.length > 120) {
      throw invalid("Họ tên phải có từ 2 đến 120 ký tự.");
    }
    return value;
  }
  if (field === "phone") {
    const digits = phoneDigits(value);
    if (!/^[0-9 +()-]{8,20}$/.test(value) || digits.length < 8 || digits.length > 15) {
      throw invalid("Vui lòng kiểm tra số điện thoại.");
    }
    return value;
  }
  if (field === "address") {
    if (value.length < 10 || value.length > 300) {
      throw invalid("Địa chỉ phải có từ 10 đến 300 ký tự.");
    }
    return value;
  }
  throw invalid("Thông tin khách hàng không hợp lệ.");
}

/**
 * Validates the raw request payload. Returns the normalized changes and the
 * optional confirmation credential. Throws ProfileUpdateError on violation.
 */
function parseProfileUpdate(payload, sanitizePlainText = (value) => value) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProfileUpdateError(400, "Thông tin khách hàng không hợp lệ.", "INVALID_PAYLOAD");
  }
  const keys = Object.keys(payload);
  const verificationField = keys.find((key) => Object.hasOwn(VERIFICATION_REQUIRED_FIELDS, key));
  if (verificationField) {
    throw new ProfileUpdateError(
      403,
      VERIFICATION_REQUIRED_FIELDS[verificationField],
      "VERIFICATION_REQUIRED",
    );
  }
  const allowed = new Set([...SELF_SERVICE_FIELDS, ...CONFIRMATION_FIELDS]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new ProfileUpdateError(400, "Thông tin khách hàng không hợp lệ.", "INVALID_PAYLOAD");
  }

  const changes = {};
  for (const field of SELF_SERVICE_FIELDS) {
    if (!Object.hasOwn(payload, field)) continue;
    const rawValue = payload[field];
    if (typeof rawValue !== "string") {
      throw new ProfileUpdateError(400, "Thông tin khách hàng không hợp lệ.", "INVALID_FIELD");
    }
    const limit = field === "phone" ? 20 : field === "address" ? 300 : 120;
    // Validate against the length before truncation so oversized values fail.
    const normalized = collapseWhitespace(sanitizePlainText(rawValue, limit + 1));
    changes[field] = validateField(field, normalized);
  }
  if (Object.keys(changes).length === 0) {
    throw new ProfileUpdateError(400, "Thông tin khách hàng không hợp lệ.", "INVALID_PAYLOAD");
  }
  if (payload.currentPassword !== undefined && typeof payload.currentPassword !== "string") {
    throw new ProfileUpdateError(400, "Thông tin xác nhận không hợp lệ.", "INVALID_PAYLOAD");
  }
  return {
    changes,
    currentPassword: typeof payload.currentPassword === "string" ? payload.currentPassword : "",
  };
}

/** Returns only the fields whose value actually differs from what is stored. */
function diffCustomerInfo(current, changes) {
  const stored = current && typeof current === "object" ? current : {};
  const changed = {};
  for (const [field, value] of Object.entries(changes)) {
    const previous = typeof stored[field] === "string" ? stored[field] : "";
    // A phone number that only differs in formatting is not a change.
    const same = field === "phone"
      ? phoneDigits(previous) === phoneDigits(value)
      : previous === value;
    if (!same) changed[field] = value;
  }
  return changed;
}

/** Replacing an existing value of an important field needs confirmation. */
function requiresConfirmation(current, changed) {
  const stored = current && typeof current === "object" ? current : {};
  return CONFIRMATION_REQUIRED_FIELDS.some((field) => (
    Object.hasOwn(changed, field) &&
    typeof stored[field] === "string" &&
    stored[field] !== ""
  ));
}

/** True when another active account already stores the same phone number. */
function findPhoneConflict(users, userId, phone) {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  return (users || []).some((entry) => (
    entry &&
    entry.id !== userId &&
    entry.isActive !== false &&
    phoneDigits(entry.customerInfo?.phone) === digits
  ));
}

/** Keeps only allowed fields when persisting, regardless of the caller. */
function pickSelfServiceFields(customerInfo) {
  const safe = {};
  for (const field of SELF_SERVICE_FIELDS) {
    if (typeof customerInfo?.[field] === "string") safe[field] = customerInfo[field];
  }
  return safe;
}

module.exports = {
  CONFIRMATION_REQUIRED_FIELDS,
  ProfileUpdateError,
  RECENT_LOGIN_WINDOW_MS,
  SELF_SERVICE_FIELDS,
  VERIFICATION_REQUIRED_FIELDS,
  diffCustomerInfo,
  findPhoneConflict,
  parseProfileUpdate,
  phoneDigits,
  pickSelfServiceFields,
  requiresConfirmation,
};
