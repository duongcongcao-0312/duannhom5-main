const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs/promises");
const path = require("node:path");
const { redactLogText } = require("./monitoring");
const auditRequestContext = new AsyncLocalStorage();
const auditWriteQueues = new Map();

const AUDIT_OUTCOMES = Object.freeze(["attempt", "success", "denied", "failure"]);

const AUDIT_POLICY = Object.freeze({
  version: "2026-01",
  retentionDays: 365,
  minimumFields: Object.freeze([
    "id",
    "timestamp",
    "action",
    "actorId",
    "actorRole",
    "entityType",
    "entityId",
    "outcome",
    "statusCode",
    "requestId",
  ]),
  outcomes: AUDIT_OUTCOMES,
  immutability:
    "Append-only JSONL with SHA-256 hash chain, 0600 file permissions, and read-only admin API (mutations rejected with 405).",
  auditedOperations: Object.freeze([
    "admin.api.request / admin.api.denied / admin.api.failure (all /api/admin/* calls & outcomes)",
    "staff.profile.create / staff.profile.update (staff provisioning, role changes, deactivation)",
    "user.student_verification.update (student discount verification)",
    "order.status.update / order.payment.update (order workflow, payment & refund transitions)",
    "book.create / book.update / book.delete (catalog & stock administration)",
    "coupon.create / coupon.update (discount & coupon administration)",
    "service.status.update (book service request administration)",
    "customer.* / customer_interaction.* (CRM administration)",
    "privacy.data_request.update / privacy.export.* (DSAR & personal data export)",
  ]),
});

const SENSITIVE_AUDIT_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|session|card|cvv|pan|signature|api.?key|private.?key|access.?code|bearer|otp|pin|bank.?account|citizen|passport|ssn|email|phone|address|customer(?:name|info)|full.?name|^name$|^note$)/i;

function sanitizeAuditValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactLogText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditValue(entry, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_AUDIT_KEY_PATTERN.test(key)) {
        continue;
      }
      next[key] = sanitizeAuditValue(item, seen);
    }
    return next;
  }
  return String(value);
}

function normalizeOutcome(outcome) {
  if (typeof outcome === "string") {
    const normalized = outcome.trim().toLowerCase();
    if (AUDIT_OUTCOMES.includes(normalized)) return normalized;
  }
  return "success";
}

function normalizeAuditEvent(event = {}) {
  const timestamp = new Date().toISOString();
  const sanitized = sanitizeAuditValue(event);
  const statusCode =
    Number.isInteger(sanitized.statusCode) &&
    sanitized.statusCode >= 100 &&
    sanitized.statusCode <= 599
      ? sanitized.statusCode
      : null;
  const entry = {
    id: typeof sanitized.id === "string" && sanitized.id.trim() ? sanitized.id.trim() : crypto.randomUUID(),
    timestamp: typeof sanitized.timestamp === "string" && sanitized.timestamp ? sanitized.timestamp : timestamp,
    action: typeof sanitized.action === "string" && sanitized.action.trim() ? sanitized.action.trim() : "admin_action",
    actorId: typeof sanitized.actorId === "string" ? sanitized.actorId.trim() : sanitized.actorId ?? null,
    actorRole: typeof sanitized.actorRole === "string" ? sanitized.actorRole.trim() : sanitized.actorRole ?? null,
    entityType: typeof sanitized.entityType === "string" && sanitized.entityType.trim()
      ? sanitized.entityType.trim()
      : "resource",
    entityId: typeof sanitized.entityId === "string" ? sanitized.entityId.trim() : sanitized.entityId ?? null,
    outcome: normalizeOutcome(sanitized.outcome),
    statusCode,
    before: sanitized.before === undefined ? null : sanitized.before,
    after: sanitized.after === undefined ? null : sanitized.after,
    requestId: typeof sanitized.requestId === "string"
      ? sanitized.requestId.trim()
      : sanitized.requestId ?? auditRequestContext.getStore() ?? null,
    metadata: sanitized.metadata === undefined ? {} : sanitizeAuditValue(sanitized.metadata),
  };
  if (entry.actorId === "") entry.actorId = null;
  if (entry.actorRole === "") entry.actorRole = null;
  if (entry.entityId === "") entry.entityId = null;
  return entry;
}

function withAuditRequestContext(requestId, operation) {
  return auditRequestContext.run(requestId, operation);
}

function computeAuditEntryHash(previousHash, entry) {
  return crypto
    .createHash("sha256")
    .update(`${previousHash || ""}\n${JSON.stringify(entry)}`)
    .digest("hex");
}

async function writeAuditEntry(absolutePath, event) {
  const normalizedEvent = normalizeAuditEvent(event);
  let previousHash = null;
  try {
    const existing = await fs.readFile(absolutePath, "utf8");
    const lines = existing.split(/\r?\n/).filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      const lastEntry = JSON.parse(lastLine);
      previousHash = typeof lastEntry.hash === "string" ? lastEntry.hash : null;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const entry = { ...normalizedEvent, previousHash };
  entry.hash = computeAuditEntryHash(previousHash, entry);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.appendFile(absolutePath, `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(absolutePath, 0o600);
  return entry;
}

async function appendAuditEntry(filePath, event) {
  const absolutePath = path.resolve(filePath);
  const previousWrite = auditWriteQueues.get(absolutePath) || Promise.resolve();
  const performWrite = () => writeAuditEntry(absolutePath, event);
  const write = previousWrite.then(performWrite, performWrite);
  auditWriteQueues.set(absolutePath, write);
  try {
    return await write;
  } finally {
    if (auditWriteQueues.get(absolutePath) === write) {
      auditWriteQueues.delete(absolutePath);
    }
  }
}

async function readAuditEntries(filePath) {
  const absolutePath = path.resolve(filePath);
  const pendingWrite = auditWriteQueues.get(absolutePath);
  if (pendingWrite) {
    await pendingWrite.catch(() => {});
  }
  try {
    const fileContents = await fs.readFile(absolutePath, "utf8");
    const lines = fileContents.split(/\r?\n/).filter(Boolean);
    let previousHash = null;
    const entries = [];
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Audit log is corrupted at ${absolutePath}: ${error.message}`);
      }
      if (parsed.previousHash !== previousHash) {
        throw new Error("Audit log chain was broken or tampered with.");
      }
      const hashPayload = {
        id: parsed.id,
        timestamp: parsed.timestamp,
        action: parsed.action,
        actorId: parsed.actorId,
        actorRole: parsed.actorRole,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        ...(Object.prototype.hasOwnProperty.call(parsed, "outcome")
          ? { outcome: parsed.outcome }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(parsed, "statusCode")
          ? { statusCode: parsed.statusCode }
          : {}),
        before: parsed.before,
        after: parsed.after,
        requestId: parsed.requestId,
        metadata: parsed.metadata,
        previousHash: parsed.previousHash,
      };
      const expectedHash = computeAuditEntryHash(previousHash, hashPayload);
      if (parsed.hash !== expectedHash) {
        throw new Error("Audit log hash validation failed.");
      }
      entries.push(parsed);
      previousHash = parsed.hash;
    }
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

module.exports = {
  AUDIT_OUTCOMES,
  AUDIT_POLICY,
  appendAuditEntry,
  computeAuditEntryHash,
  normalizeAuditEvent,
  readAuditEntries,
  sanitizeAuditValue,
  withAuditRequestContext,
};
