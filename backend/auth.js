const crypto = require("node:crypto");
const { normalizeRole } = require("./business-constants");
const { secureHashPasswordResetToken } = require("./security");
const { redactLogText } = require("./monitoring");

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
  return secureHashPasswordResetToken(token);
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SESSION_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

class RefreshTokenReuseError extends Error {
  constructor(userId) {
    super("Refresh token reuse detected; all sessions for this user have been revoked.");
    this.name = "RefreshTokenReuseError";
    this.code = "REFRESH_TOKEN_REUSE_DETECTED";
    this.userId = userId || null;
  }
}

function isPasswordValid(password) {
  return typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password.trim().length > 0;
}

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.consumedRefreshHashes = new Map();
    this._refreshLocks = new Map();
    this.repository = options.repository || null;
    this.sessionTtlMs = Number.isFinite(options.sessionTtlMs)
      ? options.sessionTtlMs
      : SESSION_TTL_MS;
    this.idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
      ? options.idleTimeoutMs
      : SESSION_IDLE_TIMEOUT_MS;
    this.refreshTtlMs = Number.isFinite(options.refreshTtlMs)
      ? options.refreshTtlMs
      : SESSION_REFRESH_TTL_MS;
    if (this.sessionTtlMs <= 0) {
      throw new RangeError("SESSION_TTL_MS must be greater than zero.");
    }
    if (this.idleTimeoutMs < 0) {
      throw new RangeError("SESSION_IDLE_TIMEOUT_MS must be non-negative.");
    }
    if (this.refreshTtlMs <= 0) {
      throw new RangeError("SESSION_REFRESH_TTL_MS must be greater than zero.");
    }
    this.cleanupIntervalMs = Number.isFinite(options.cleanupIntervalMs)
      ? options.cleanupIntervalMs
      : 60 * 1000;
    this._cleanupTimer = null;
    if (this.cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => {
        this.pruneExpiredSessions().catch((error) => {
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            event: "expired_session_cleanup_failed",
            message: redactLogText(error?.message),
          }));
        });
      }, this.cleanupIntervalMs);
      this._cleanupTimer.unref?.();
    }
  }

  async createSession(user, sessionTtlMs = this.sessionTtlMs, refreshTtlMs = this.refreshTtlMs) {
    const token = crypto.randomUUID();
    const refreshToken = crypto.randomUUID();
    const now = Date.now();
    const sessionData = {
      token,
      refreshToken,
      refreshTokenHash: hashPasswordResetToken(refreshToken),
      refreshExpiresAt: now + Number(refreshTtlMs),
      userId: user.id,
      email: user.email,
      name: user.name,
      role: normalizeRole(user.role),
      studentType: user.studentType || "other",
      studentId: user.studentId || "",
      studentVerification: user.studentVerification || { status: "pending" },
      customerInfo: user.customerInfo || {},
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      idleExpiresAt: this.idleTimeoutMs > 0 ? now + this.idleTimeoutMs : null,
      expiresAt: now + Number(sessionTtlMs),
    };
    if (this.repository) {
      const storedSession = { ...sessionData };
      delete storedSession.token;
      delete storedSession.refreshToken;
      await this.repository.saveSessionRecord(
        hashPasswordResetToken(token),
        storedSession,
      );
    } else {
      this.sessions.set(token, { ...sessionData, refreshToken: undefined });
    }
    return sessionData;
  }

  async getSession(token) {
    if (!token || typeof token !== "string") return null;
    const session = this.repository
      ? await this.repository.getSessionRecord(hashPasswordResetToken(token))
      : this.sessions.get(token);
    if (!session) return null;
    const sanitizedSession = { ...session };
    delete sanitizedSession.refreshToken;
    const now = Date.now();
    const isIdleExpired =
      this.idleTimeoutMs > 0 &&
      Number.isFinite(sanitizedSession.lastActivityAt) &&
      now - sanitizedSession.lastActivityAt >= this.idleTimeoutMs;
    if (now >= sanitizedSession.expiresAt || isIdleExpired) {
      await this.destroySession(token);
      return null;
    }
    if (this.idleTimeoutMs > 0) {
      const prevLastActivity = Number.isFinite(sanitizedSession.lastActivityAt)
        ? sanitizedSession.lastActivityAt
        : now;
      sanitizedSession.lastActivityAt = now;
      sanitizedSession.idleExpiresAt = now + this.idleTimeoutMs;
      if (this.repository) {
        const persistThresholdMs = Math.min(60 * 1000, Math.floor(this.idleTimeoutMs / 4));
        if (now - prevLastActivity >= persistThresholdMs) {
          const storedSession = { ...sanitizedSession };
          delete storedSession.token;
          await this.repository.saveSessionRecord(
            hashPasswordResetToken(token),
            storedSession,
          );
        }
      } else {
        this.sessions.set(token, { ...sanitizedSession, refreshToken: undefined });
      }
    }
    return { ...sanitizedSession, token };
  }

  async refreshSession(token, refreshTokenOrSessionTtlMs, maybeRefreshTtlMs) {
    const session = await this.getSession(token);
    if (!session) return null;
    const now = Date.now();
    let refreshToken = null;
    let sessionTtlMs = this.sessionTtlMs;
    let refreshTtlMs = this.refreshTtlMs;

    if (typeof refreshTokenOrSessionTtlMs === "string") {
      refreshToken = refreshTokenOrSessionTtlMs;
      if (Number.isFinite(Number(maybeRefreshTtlMs))) {
        sessionTtlMs = Number(maybeRefreshTtlMs);
      }
    } else if (Number.isFinite(Number(refreshTokenOrSessionTtlMs))) {
      sessionTtlMs = Number(refreshTokenOrSessionTtlMs);
      refreshTtlMs = Number.isFinite(Number(maybeRefreshTtlMs))
        ? Number(maybeRefreshTtlMs)
        : refreshTtlMs;
    }

    if (Number.isFinite(session.refreshExpiresAt) && now >= session.refreshExpiresAt) {
      await this.destroySession(token);
      return null;
    }
    if (refreshToken && !this.verifyRefreshToken(refreshToken, session)) {
      return null;
    }

    session.updatedAt = now;
    session.lastActivityAt = now;
    session.idleExpiresAt = this.idleTimeoutMs > 0 ? now + this.idleTimeoutMs : null;
    session.expiresAt = now + Number(sessionTtlMs);
    if (Number.isFinite(Number(maybeRefreshTtlMs))) {
      session.refreshExpiresAt = now + Number(refreshTtlMs);
    } else if (!Number.isFinite(session.refreshExpiresAt)) {
      session.refreshExpiresAt = now + Number(refreshTtlMs);
    }
    if (this.repository) {
      const storedSession = { ...session };
      delete storedSession.token;
      delete storedSession.refreshToken;
      await this.repository.saveSessionRecord(
        hashPasswordResetToken(token),
        storedSession,
      );
    } else {
      this.sessions.set(token, { ...session, refreshToken: undefined });
    }
    return session;
  }

  verifyRefreshToken(refreshToken, session) {
    if (!refreshToken || typeof refreshToken !== "string") return false;
    if (!session || typeof session !== "object") return false;
    if (Number.isFinite(session.refreshExpiresAt) && Date.now() >= session.refreshExpiresAt) {
      return false;
    }
    const expectedHash = hashPasswordResetToken(refreshToken);
    const suppliedHash = typeof session.refreshTokenHash === "string"
      ? session.refreshTokenHash
      : "";
    if (!suppliedHash || !expectedHash) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedHash, "hex"),
        Buffer.from(suppliedHash, "hex"),
      );
    } catch {
      return false;
    }
  }

  async _withTokenLock(token, operation) {
    const key = typeof token === "string" && token ? token : "__none__";
    const previous = this._refreshLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this._refreshLocks.set(key, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this._refreshLocks.get(key) === chain) {
        this._refreshLocks.delete(key);
      }
    }
  }

  _getConsumedRefreshRecord(refreshToken) {
    if (!refreshToken || typeof refreshToken !== "string") return null;
    const hash = hashPasswordResetToken(refreshToken);
    const record = this.consumedRefreshHashes.get(hash);
    if (!record) return null;
    if (Date.now() >= record.expiresAt) {
      this.consumedRefreshHashes.delete(hash);
      return null;
    }
    return record;
  }

  async rotateSession(token, refreshTokenOrSessionTtlMs, maybeRefreshTtlMs) {
    return this._withTokenLock(token, async () => {
      const now = Date.now();
      let refreshToken = null;
      let sessionTtlMs = this.sessionTtlMs;
      let refreshTtlMs = this.refreshTtlMs;

      if (typeof refreshTokenOrSessionTtlMs === "string") {
        refreshToken = refreshTokenOrSessionTtlMs;
        if (Number.isFinite(Number(maybeRefreshTtlMs))) {
          sessionTtlMs = Number(maybeRefreshTtlMs);
        }
      } else if (Number.isFinite(Number(refreshTokenOrSessionTtlMs))) {
        sessionTtlMs = Number(refreshTokenOrSessionTtlMs);
        refreshTtlMs = Number.isFinite(Number(maybeRefreshTtlMs))
          ? Number(maybeRefreshTtlMs)
          : refreshTtlMs;
      }

      if (refreshToken) {
        const consumed = this._getConsumedRefreshRecord(refreshToken);
        if (consumed) {
          await this.destroyUserSessions(consumed.userId);
          throw new RefreshTokenReuseError(consumed.userId);
        }
      }

      const session = await this.getSession(token);
      if (!session) return null;

      if (Number.isFinite(session.refreshExpiresAt) && now >= session.refreshExpiresAt) {
        await this.destroySession(token);
        return null;
      }
      if (refreshToken && !this.verifyRefreshToken(refreshToken, session)) {
        return null;
      }

      const nextToken = crypto.randomUUID();
      const nextRefreshToken = crypto.randomUUID();
      const nextRefreshExpiresAt = Number.isFinite(Number(maybeRefreshTtlMs))
        ? now + Number(refreshTtlMs)
        : (Number.isFinite(session.refreshExpiresAt) ? session.refreshExpiresAt : now + Number(refreshTtlMs));
      const rotatedSession = {
        ...session,
        token: nextToken,
        refreshToken: nextRefreshToken,
        refreshTokenHash: hashPasswordResetToken(nextRefreshToken),
        updatedAt: now,
        lastActivityAt: now,
        idleExpiresAt: this.idleTimeoutMs > 0 ? now + this.idleTimeoutMs : null,
        expiresAt: now + Number(sessionTtlMs),
        refreshExpiresAt: nextRefreshExpiresAt,
      };
      if (typeof session.refreshTokenHash === "string" && session.refreshTokenHash) {
        this.consumedRefreshHashes.set(session.refreshTokenHash, {
          userId: session.userId,
          expiresAt: nextRefreshExpiresAt,
        });
      }
      if (this.repository) {
        const storedSession = { ...rotatedSession };
        delete storedSession.token;
        delete storedSession.refreshToken;
        await this.repository.deleteSessionRecord(hashPasswordResetToken(token));
        await this.repository.saveSessionRecord(
          hashPasswordResetToken(nextToken),
          storedSession,
        );
      } else {
        this.sessions.delete(token);
        this.sessions.set(nextToken, { ...rotatedSession, refreshToken: undefined });
      }
      return rotatedSession;
    });
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
    const now = Date.now();
    for (const [hash, record] of this.consumedRefreshHashes) {
      if (now >= record.expiresAt) {
        this.consumedRefreshHashes.delete(hash);
      }
    }
    if (this.repository) {
      return this.repository.pruneExpiredSessionRecords();
    }
    let removed = 0;
    for (const [token, session] of this.sessions) {
      const isIdleExpired =
        this.idleTimeoutMs > 0 &&
        Number.isFinite(session.lastActivityAt) &&
        now - session.lastActivityAt >= this.idleTimeoutMs;
      if (now >= session.expiresAt || isIdleExpired) {
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
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_REFRESH_TTL_MS,
  verifyPassword,
  RefreshTokenReuseError,
  SessionStore
};
