const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function sanitizeAuditValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
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
      if (/(password|token|secret|authorization|cookie|session|card|cvv|pan|signature)/i.test(key)) {
        continue;
      }
      next[key] = sanitizeAuditValue(item, seen);
    }
    return next;
  }
  return String(value);
}

function normalizeAuditEvent(event = {}) {
  const timestamp = new Date().toISOString();
  const sanitized = sanitizeAuditValue(event);
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
    before: sanitized.before === undefined ? null : sanitized.before,
    after: sanitized.after === undefined ? null : sanitized.after,
    requestId: typeof sanitized.requestId === "string" ? sanitized.requestId.trim() : sanitized.requestId ?? null,
    metadata: sanitized.metadata === undefined ? {} : sanitizeAuditValue(sanitized.metadata),
  };
  if (entry.actorId === "") entry.actorId = null;
  if (entry.actorRole === "") entry.actorRole = null;
  if (entry.entityId === "") entry.entityId = null;
  return entry;
}

function computeAuditEntryHash(previousHash, entry) {
  return crypto
    .createHash("sha256")
    .update(`${previousHash || ""}\n${JSON.stringify(entry)}`)
    .digest("hex");
}

async function appendAuditEntry(filePath, event) {
  const absolutePath = path.resolve(filePath);
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
  await fs.appendFile(absolutePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

async function readAuditEntries(filePath) {
  const absolutePath = path.resolve(filePath);
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
      const expectedHash = computeAuditEntryHash(previousHash, {
        id: parsed.id,
        timestamp: parsed.timestamp,
        action: parsed.action,
        actorId: parsed.actorId,
        actorRole: parsed.actorRole,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        before: parsed.before,
        after: parsed.after,
        requestId: parsed.requestId,
        metadata: parsed.metadata,
        previousHash: parsed.previousHash,
      });
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
  appendAuditEntry,
  computeAuditEntryHash,
  normalizeAuditEvent,
  readAuditEntries,
  sanitizeAuditValue,
};
