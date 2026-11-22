"use strict";

const crypto = require("node:crypto");
const { pickSelfServiceFields } = require("./profile-update");

/**
 * Personal data export policy and short-lived download store (BN-195 / issue #271).
 *
 * - Format: UTF-8 JSON (`application/json`), machine-readable.
 * - Ownership: only records strictly bound to `user.id` are included.
 * - Exclusions: credentials, tokens, third-party/guest orders, anonymous
 *   service requests, internal CRM notes, audit logs, and staff identifiers.
 * - Protection: downloads require both the owner's authenticated session and
 *   a one-time-returned secret download token (sent via `X-Export-Token`),
 *   expire automatically after `ttlMs`, and never log personal values or tokens.
 */

const EXPORT_FORMATS = Object.freeze(["json"]);
const EXPORT_SCHEMA_VERSION = "1.0";
const EXPORT_DOWNLOAD_TTL_MS = 15 * 60 * 1000;
const EXPORT_EXCLUDED_CATEGORIES = Object.freeze([
  "passwords_and_security_tokens",
  "third_party_and_guest_orders",
  "anonymous_service_requests",
  "internal_crm_and_staff_notes",
  "admin_audit_logs",
  "internal_staff_identifiers",
]);

function hashDownloadToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function timingSafeHexEqual(leftHex, rightHex) {
  if (typeof leftHex !== "string" || typeof rightHex !== "string") return false;
  if (leftHex.length !== rightHex.length || leftHex.length === 0) return false;
  return crypto.timingSafeEqual(Buffer.from(leftHex, "utf8"), Buffer.from(rightHex, "utf8"));
}

function extractLinkedProviders(user) {
  const providers = new Set();
  if (typeof user?.authProvider === "string" && user.authProvider.trim()) {
    providers.add(user.authProvider.trim().toLowerCase());
  }
  if (Array.isArray(user?.socialAccounts)) {
    for (const account of user.socialAccounts) {
      if (typeof account?.provider === "string" && account.provider.trim()) {
        providers.add(account.provider.trim().toLowerCase());
      }
    }
  }
  return Array.from(providers).sort();
}

function sanitizeExportAccount(user) {
  const verification = user?.studentVerification && typeof user.studentVerification === "object"
    ? user.studentVerification
    : {};
  return {
    id: user.id,
    name: typeof user.name === "string" ? user.name : "",
    email: typeof user.email === "string" ? user.email : "",
    role: typeof user.role === "string" ? user.role : "user",
    studentType: typeof user.studentType === "string" ? user.studentType : "other",
    studentId: typeof user.studentId === "string" ? user.studentId : "",
    studentVerification: {
      status: typeof verification.status === "string" ? verification.status : "pending",
      requestedAt: verification.requestedAt || null,
      verifiedAt: verification.verifiedAt || null,
    },
    linkedSocialProviders: extractLinkedProviders(user),
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function sanitizeExportOrder(order) {
  const items = Array.isArray(order?.items)
    ? order.items.map((item) => ({
        title: typeof item?.title === "string" ? item.title : "",
        quantity: Number.isInteger(item?.quantity) ? item.quantity : 0,
        lineTotal: Number.isFinite(Number(item?.lineTotal)) ? Number(item.lineTotal) : 0,
      }))
    : [];
  return {
    orderId: order.orderId,
    createdAt: order.createdAt || null,
    status: order.status || null,
    paymentStatus: order.paymentStatus || null,
    paymentMethod: order.paymentMethod || null,
    ...(order.paymentCode ? { paymentCode: order.paymentCode } : {}),
    couponCode: order.couponCode || null,
    subtotal: Number.isFinite(Number(order.subtotal)) ? Number(order.subtotal) : 0,
    discount: Number.isFinite(Number(order.discount)) ? Number(order.discount) : 0,
    total: Number.isFinite(Number(order.total)) ? Number(order.total) : 0,
    customerName: typeof order.customerName === "string" ? order.customerName : "",
    phone: typeof order.phone === "string" ? order.phone : "",
    address: typeof order.address === "string" ? order.address : "",
    items,
  };
}

function sanitizeExportConsent(record) {
  return {
    id: record.id,
    purpose: record.purpose,
    consent: Boolean(record.consent),
    policyVersion: record.policyVersion || null,
    dataSource: record.dataSource || null,
    retentionDays: Number.isInteger(record.retentionDays) ? record.retentionDays : 0,
    createdAt: record.createdAt || null,
    revokedAt: record.revokedAt || null,
  };
}

function sanitizeExportDataRequest(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    resolvedAt: record.resolvedAt || null,
  };
}

function buildPersonalDataExport({
  user,
  orders = [],
  consents = [],
  dataRequests = [],
  exportedAt = new Date().toISOString(),
}) {
  if (!user || typeof user.id !== "string" || !user.id) {
    throw new TypeError("Valid user record is required to build personal data export.");
  }
  const ownedOrders = (Array.isArray(orders) ? orders : [])
    .filter((order) => order && order.userId === user.id)
    .map(sanitizeExportOrder);
  const ownedConsents = (Array.isArray(consents) ? consents : [])
    .filter((record) => record && record.subjectId === user.id)
    .map(sanitizeExportConsent);
  const ownedRequests = (Array.isArray(dataRequests) ? dataRequests : [])
    .filter((record) => record && record.subjectId === user.id)
    .map(sanitizeExportDataRequest);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    format: "json",
    exportedAt,
    scope: {
      included: ["account", "customerInfo", "orders", "consents", "privacyDataRequests"],
      excluded: [...EXPORT_EXCLUDED_CATEGORIES],
    },
    account: sanitizeExportAccount(user),
    customerInfo: pickSelfServiceFields(user.customerInfo),
    orders: ownedOrders,
    consents: ownedConsents,
    privacyDataRequests: ownedRequests,
  };
}

function formatExportMetadata(entry, nowMs) {
  const expired = nowMs >= entry.expiresAt;
  return {
    id: entry.id,
    format: entry.format,
    filename: entry.filename,
    downloadUrl: `/api/privacy/exports/${entry.id}/download`,
    createdAt: new Date(entry.createdAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    expired,
    byteLength: entry.byteLength,
    sha256: entry.sha256,
    downloadCount: entry.downloadCount,
    downloadedAt: entry.downloadedAt ? new Date(entry.downloadedAt).toISOString() : null,
    counts: { ...entry.counts },
  };
}

class PrivacyExportStore {
  constructor({ ttlMs = EXPORT_DOWNLOAD_TTL_MS, now = () => Date.now() } = {}) {
    if (!Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) {
      throw new RangeError("privacyExportTtlMs must be a positive number.");
    }
    this.ttlMs = Number(ttlMs);
    this.now = now;
    this.exports = new Map();
  }

  pruneExpiredPayloads() {
    const current = this.now();
    for (const entry of this.exports.values()) {
      if (current >= entry.expiresAt && entry.payload !== null) {
        entry.payload = null;
      }
    }
  }

  findActiveExport(userId) {
    this.pruneExpiredPayloads();
    const current = this.now();
    for (const entry of this.exports.values()) {
      if (entry.userId === userId && current < entry.expiresAt) {
        return entry;
      }
    }
    return null;
  }

  createExport(userId, exportData) {
    this.pruneExpiredPayloads();
    const current = this.now();
    const active = this.findActiveExport(userId);
    if (active) {
      return {
        conflict: true,
        activeExport: formatExportMetadata(active, current),
      };
    }

    const id = crypto.randomUUID();
    const downloadToken = crypto.randomBytes(32).toString("hex");
    const serialized = `${JSON.stringify(exportData, null, 2)}\n`;
    const payload = Buffer.from(serialized, "utf8");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
    const entry = {
      id,
      userId,
      format: "json",
      filename: `booknest-personal-data-${id.slice(0, 8)}.json`,
      downloadTokenHash: hashDownloadToken(downloadToken),
      payload,
      byteLength: payload.byteLength,
      sha256,
      createdAt: current,
      expiresAt: current + this.ttlMs,
      downloadCount: 0,
      downloadedAt: null,
      counts: {
        orders: Array.isArray(exportData?.orders) ? exportData.orders.length : 0,
        consents: Array.isArray(exportData?.consents) ? exportData.consents.length : 0,
        privacyDataRequests: Array.isArray(exportData?.privacyDataRequests)
          ? exportData.privacyDataRequests.length
          : 0,
      },
    };
    this.exports.set(id, entry);
    return {
      conflict: false,
      record: formatExportMetadata(entry, current),
      downloadToken,
    };
  }

  listUserExports(userId) {
    this.pruneExpiredPayloads();
    const current = this.now();
    return Array.from(this.exports.values())
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((entry) => formatExportMetadata(entry, current));
  }

  getDownload(exportId, userId, downloadToken) {
    this.pruneExpiredPayloads();
    const entry = this.exports.get(exportId);
    if (!entry) return { status: "not_found" };
    if (entry.userId !== userId) return { status: "forbidden" };
    const current = this.now();
    if (current >= entry.expiresAt || entry.payload === null) {
      entry.payload = null;
      return { status: "expired" };
    }
    const providedHash = hashDownloadToken(downloadToken);
    if (!downloadToken || !timingSafeHexEqual(entry.downloadTokenHash, providedHash)) {
      return { status: "invalid_token" };
    }
    entry.downloadCount += 1;
    entry.downloadedAt = current;
    return {
      status: "ok",
      id: entry.id,
      filename: entry.filename,
      payload: entry.payload,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
      downloadCount: entry.downloadCount,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }

  close() {
    for (const entry of this.exports.values()) {
      entry.payload = null;
    }
    this.exports.clear();
  }
}

module.exports = {
  EXPORT_DOWNLOAD_TTL_MS,
  EXPORT_EXCLUDED_CATEGORIES,
  EXPORT_FORMATS,
  EXPORT_SCHEMA_VERSION,
  PrivacyExportStore,
  buildPersonalDataExport,
};
