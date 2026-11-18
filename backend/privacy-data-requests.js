const PRIVACY_DATA_REQUEST_TYPES = Object.freeze(["access", "update", "delete"]);
const PRIVACY_DATA_REQUEST_STATUSES = Object.freeze([
  "pending",
  "processing",
  "completed",
  "rejected",
]);

const transitions = Object.freeze({
  pending: new Set(["processing", "completed", "rejected"]),
  processing: new Set(["completed", "rejected"]),
});

function isPrivacyDataRequestTransitionAllowed(currentStatus, nextStatus) {
  return transitions[currentStatus]?.has(nextStatus) === true;
}

function mapPrivacyDataRequestRow(row) {
  return {
    id: row.request_id,
    subjectId: row.subject_id,
    type: row.request_type,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

module.exports = {
  PRIVACY_DATA_REQUEST_STATUSES,
  PRIVACY_DATA_REQUEST_TYPES,
  isPrivacyDataRequestTransitionAllowed,
  mapPrivacyDataRequestRow,
};
