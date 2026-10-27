const crypto = require("node:crypto");

/**
 * Hash a plain password using scrypt
 * Format: salt:hash
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plain password against stored salt:hash
 */
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) {
    return false;
  }
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  try {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * In-memory session store with token expiration and production-friendly cleanup.
 */
class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.sessionTtlMs = Number.isFinite(options.sessionTtlMs)
      ? options.sessionTtlMs
      : 7 * 24 * 60 * 60 * 1000;
    this.cleanupIntervalMs = Number.isFinite(options.cleanupIntervalMs)
      ? options.cleanupIntervalMs
      : 60 * 1000;
    this._cleanupTimer = null;
    if (this.cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => this.pruneExpiredSessions(), this.cleanupIntervalMs);
      this._cleanupTimer.unref?.();
    }
  }

  createSession(user, sessionTtlMs = this.sessionTtlMs) {
    const token = crypto.randomUUID();
    const now = Date.now();
    const sessionData = {
      token,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role || "user",
      studentType: user.studentType || "other",
      studentId: user.studentId || "",
      customerInfo: user.customerInfo || {},
      createdAt: now,
      updatedAt: now,
      expiresAt: now + Number(sessionTtlMs),
    };
    this.sessions.set(token, sessionData);
    return sessionData;
  }

  getSession(token) {
    if (!token || typeof token !== "string") return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  refreshSession(token, sessionTtlMs = this.sessionTtlMs) {
    const session = this.getSession(token);
    if (!session) return null;
    const now = Date.now();
    session.updatedAt = now;
    session.expiresAt = now + Number(sessionTtlMs);
    return session;
  }

  destroySession(token) {
    if (!token || typeof token !== "string") return false;
    return this.sessions.delete(token);
  }

  destroyUserSessions(userId) {
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  pruneExpiredSessions() {
    const now = Date.now();
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  close() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

module.exports = {
  hashPassword,
  hashPasswordResetToken,
  verifyPassword,
  SessionStore
};
