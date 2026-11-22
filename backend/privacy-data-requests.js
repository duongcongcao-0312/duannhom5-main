"use strict";

/**
 * Data-subject request (DSAR) workflow policy (BN-194 / issue #270).
 *
 * Defines intake channels, classification, internal SLA deadlines,
 * escalation levels, structured resolution codes, and status transitions.
 */

const PRIVACY_DATA_REQUEST_TYPES = Object.freeze(["access", "update", "export", "delete"]);
const PRIVACY_DATA_REQUEST_STATUSES = Object.freeze([
  "pending",
  "processing",
  "completed",
  "rejected",
]);
const PRIVACY_REQUEST_CHANNELS = Object.freeze([
  "web_portal",
  "email_support",
  "in_person",
]);
const PRIVACY_VERIFICATION_METHODS = Object.freeze([
  "session_token",
  "password_reauth",
  "manual_review",
]);
const PRIVACY_ESCALATION_LEVELS = Object.freeze([
  "l1_support",
  "l2_privacy_lead",
  "l3_legal_admin",
]);
const PRIVACY_RESOLUTION_CODES = Object.freeze([
  "fulfilled",
  "partially_fulfilled",
  "anonymized",
  "rejected_unverified",
  "rejected_legal_retention",
  "rejected_duplicate",
  "withdrawn",
]);

/** Internal SLA deadlines (in hours) per request type. */
const PRIVACY_REQUEST_SLA_HOURS = Object.freeze({
  access: 48,
  update: 48,
  export: 48,
  delete: 72,
});

const transitions = Object.freeze({
  pending: new Set(["processing", "completed", "rejected"]),
  processing: new Set(["completed", "rejected"]),
});

function isPrivacyDataRequestTransitionAllowed(currentStatus, nextStatus) {
  return transitions[currentStatus]?.has(nextStatus) === true;
}

function computePrivacyRequestDueAt(requestType, createdAtIso) {
  const slaHours = PRIVACY_REQUEST_SLA_HOURS[requestType] || 72;
  const baseTime = Date.parse(createdAtIso);
  const start = Number.isFinite(baseTime) ? baseTime : Date.now();
  return new Date(start + slaHours * 60 * 60 * 1000).toISOString();
}

function isPrivacyRequestOverdue(request, nowMs = Date.now()) {
  if (!request || ["completed", "rejected"].includes(request.status)) return false;
  const dueMs = Date.parse(request.dueAt);
  return Number.isFinite(dueMs) && nowMs > dueMs;
}

function enrichPrivacyDataRequest(record, nowMs = Date.now()) {
  if (!record) return null;
  const dueAt = record.dueAt || computePrivacyRequestDueAt(record.type, record.createdAt);
  const enriched = {
    id: record.id,
    subjectId: record.subjectId,
    type: record.type,
    status: record.status,
    channel: record.channel || "web_portal",
    verificationMethod: record.verificationMethod || "session_token",
    assignedTo: record.assignedTo || null,
    escalationLevel: record.escalationLevel || "l1_support",
    resolutionCode: record.resolutionCode || null,
    dueAt,
    overdue: isPrivacyRequestOverdue({ ...record, dueAt }, nowMs),
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolvedAt: record.resolvedAt || null,
  };
  return enriched;
}

function mapPrivacyDataRequestRow(row) {
  const createdAt = new Date(row.created_at).toISOString();
  const dueAt = row.due_at
    ? new Date(row.due_at).toISOString()
    : computePrivacyRequestDueAt(row.request_type, createdAt);
  return enrichPrivacyDataRequest({
    id: row.request_id,
    subjectId: row.subject_id,
    type: row.request_type,
    status: row.status,
    channel: row.channel || "web_portal",
    verificationMethod: row.verification_method || "session_token",
    assignedTo: row.assigned_to || null,
    escalationLevel: row.escalation_level || "l1_support",
    resolutionCode: row.resolution_code || null,
    dueAt,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt,
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  });
}

module.exports = {
  PRIVACY_DATA_REQUEST_STATUSES,
  PRIVACY_DATA_REQUEST_TYPES,
  PRIVACY_ESCALATION_LEVELS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_SLA_HOURS,
  PRIVACY_RESOLUTION_CODES,
  PRIVACY_VERIFICATION_METHODS,
  computePrivacyRequestDueAt,
  enrichPrivacyDataRequest,
  isPrivacyDataRequestTransitionAllowed,
  isPrivacyRequestOverdue,
  mapPrivacyDataRequestRow,
};
