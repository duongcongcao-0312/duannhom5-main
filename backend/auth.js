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

/**
 * In-memory session store with token expiration
 */
class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  createSession(user) {
    const token = crypto.randomUUID();
    const sessionData = {
      token,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role || "user",
      studentType: user.studentType || "other",
      studentId: user.studentId || "",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days validity
    };
    this.sessions.set(token, sessionData);
    return sessionData;
  }

  getSession(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  destroySession(token) {
    if (!token) return;
    this.sessions.delete(token);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  SessionStore
};

