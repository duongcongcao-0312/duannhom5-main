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

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

function isPasswordValid(password) {
  return typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password.trim().length > 0;
}

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.repository = options.repository || null;
    this.sessionTtlMs = Number.isFinite(options.sessionTtlMs)
      ? options.sessionTtlMs
      : SESSION_TTL_MS;
    if (this.sessionTtlMs <= 0) {
      throw new RangeError("SESSION_TTL_MS must be greater than zero.");
    }
    this.cleanupIntervalMs = Number.isFinite(options.cleanupIntervalMs)
      ? options.cleanupIntervalMs
      : 60 * 1000;
    this._cleanupTimer = null;
    if (this.cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => {
        this.pruneExpiredSessions().catch((error) => {
          console.error("Không thể dọn session hết hạn:", error);
        });
      }, this.cleanupIntervalMs);
      this._cleanupTimer.unref?.();
    }
  }

  async createSession(user, sessionTtlMs = this.sessionTtlMs) {
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
      studentVerification: user.studentVerification || { status: "pending" },
      customerInfo: user.customerInfo || {},
      createdAt: now,
      updatedAt: now,
      expiresAt: now + Number(sessionTtlMs),
    };
    if (this.repository) {
      const storedSession = { ...sessionData };
      delete storedSession.token;
      await this.repository.saveSessionRecord(
        hashPasswordResetToken(token),
        storedSession,
      );
    } else {
      this.sessions.set(token, sessionData);
    }
    return sessionData;
  }

  async getSession(token) {
    if (!token || typeof token !== "string") return null;
    const session = this.repository
      ? await this.repository.getSessionRecord(hashPasswordResetToken(token))
      : this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      await this.destroySession(token);
      return null;
    }
    return { ...session, token };
  }

  async refreshSession(token, sessionTtlMs = this.sessionTtlMs) {
    const session = await this.getSession(token);
    if (!session) return null;
    const now = Date.now();
    session.updatedAt = now;
    session.expiresAt = now + Number(sessionTtlMs);
    if (this.repository) {
      const storedSession = { ...session };
      delete storedSession.token;
      await this.repository.saveSessionRecord(
        hashPasswordResetToken(token),
        storedSession,
      );
    } else {
      this.sessions.set(token, session);
    }
    return session;
  }

  async destroySession(token) {
    if (!token || typeof token !== "string") return false;
    if (this.repository) {
      return this.repository.deleteSessionRecord(hashPasswordResetToken(token));
    }
    return this.sessions.delete(token);
  }

  async destroyUserSessions(userId) {
    if (this.repository) {
      return this.repository.deleteUserSessionRecords(userId);
    }
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  async pruneExpiredSessions() {
    if (this.repository) {
      return this.repository.pruneExpiredSessionRecords();
    }
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
  isPasswordValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_MS,
  verifyPassword,
  SessionStore
};
