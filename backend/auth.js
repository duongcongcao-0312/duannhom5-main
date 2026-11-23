const crypto = require("node:crypto");
const { normalizeRole } = require("./business-constants");
const { secureHashPasswordResetToken } = require("./security");
const { redactLogText } = require("./monitoring");

const PASSWORD_HASH_PARAMS = Object.freeze({
  algorithm: "scrypt",
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
});

function parsePasswordHash(stored) {
  if (typeof stored !== "string" || !stored) return null;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return null;
    const [, paramSpec, salt, key] = parts;
    if (!/^[a-f0-9]{16,}$/i.test(salt) || !/^[a-f0-9]{32,}$/i.test(key) || key.length % 2 !== 0) {
      return null;
    }
    const params = {};
    for (const pair of paramSpec.split(",")) {
      const [k, v] = pair.split("=");
      if (!k || !/^\d+$/.test(v || "")) return null;
      params[k] = Number(v);
    }
    const { N, r, p } = params;
    if (!Number.isSafeInteger(N) || N < 1024 || (N & (N - 1)) !== 0) return null;
    if (!Number.isSafeInteger(r) || r < 1 || r > 64) return null;
    if (!Number.isSafeInteger(p) || p < 1 || p > 16) return null;
    return {
      algorithm: "scrypt",
      N,
      r,
      p,
      keylen: key.length / 2,
      salt,
      key,
      legacy: false,
    };
  }
  if (stored.includes(":")) {
    const parts = stored.split(":");
    if (parts.length !== 2) return null;
    const [salt, key] = parts;
    if (!salt || !key || !/^[a-f0-9]+$/i.test(key) || key.length % 2 !== 0) return null;
    return {
      algorithm: "scrypt",
      N: 16384,
      r: 8,
      p: 1,
      keylen: key.length / 2,
      salt,
      key,
      legacy: true,
    };
  }
  return null;
}

/**
 * Hash a plain password using scrypt with explicit cost parameters.
 * Format: scrypt$N=<N>,r=<r>,p=<p>$<saltHex>$<hashHex>
 */
function hashPassword(password, params = PASSWORD_HASH_PARAMS) {
  const N = Number(params.N ?? PASSWORD_HASH_PARAMS.N);
  const r = Number(params.r ?? PASSWORD_HASH_PARAMS.r);
  const p = Number(params.p ?? PASSWORD_HASH_PARAMS.p);
  const keylen = Number(params.keylen ?? PASSWORD_HASH_PARAMS.keylen);
  const saltBytes = Number(params.saltBytes ?? PASSWORD_HASH_PARAMS.saltBytes);
  const maxmem = Number(params.maxmem ?? PASSWORD_HASH_PARAMS.maxmem);
  const salt = crypto.randomBytes(saltBytes).toString("hex");
  const hash = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem }).toString("hex");
  return `scrypt$N=${N},r=${r},p=${p}$${salt}$${hash}`;
}

/**
 * Verify a plain password against stored versioned or legacy scrypt hash.
 */
function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length === 0) {
    return false;
  }
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  try {
    const derived = crypto.scryptSync(password, parsed.salt, parsed.keylen, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(PASSWORD_HASH_PARAMS.maxmem, 256 * parsed.N * parsed.r),
    });
    const expected = Buffer.from(parsed.key, "hex");
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function needsPasswordRehash(stored, targetParams = PASSWORD_HASH_PARAMS) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return true;
  if (parsed.legacy) return true;
  return (
    parsed.N !== Number(targetParams.N ?? PASSWORD_HASH_PARAMS.N) ||
    parsed.r !== Number(targetParams.r ?? PASSWORD_HASH_PARAMS.r) ||
    parsed.p !== Number(targetParams.p ?? PASSWORD_HASH_PARAMS.p) ||
    parsed.keylen !== Number(targetParams.keylen ?? PASSWORD_HASH_PARAMS.keylen)
  );
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
  needsPasswordRehash,
  parsePasswordHash,
  PASSWORD_HASH_PARAMS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_REFRESH_TTL_MS,
  verifyPassword,
  RefreshTokenReuseError,
  SessionStore
};
