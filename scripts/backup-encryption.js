const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function loadBackupEncryptionConfig(env = process.env) {
  const requiredSetting = String(env.BACKUP_ENCRYPTION_REQUIRED || "false").toLowerCase();
  if (!["true", "false"].includes(requiredSetting)) {
    throw new Error("BACKUP_ENCRYPTION_REQUIRED phải là true hoặc false.");
  }
  const required = requiredSetting === "true";
  const encodedKey = env.BACKUP_ENCRYPTION_KEY;
  if (typeof encodedKey !== "string" || encodedKey.length === 0) {
    if (required) {
      throw new Error("BACKUP_ENCRYPTION_KEY là bắt buộc khi yêu cầu mã hóa backup.");
    }
    return { key: null, required };
  }

  const key = Buffer.from(encodedKey, "base64");
  if (
    key.length !== KEY_BYTES ||
    key.toString("base64") !== encodedKey
  ) {
    throw new Error("BACKUP_ENCRYPTION_KEY phải là base64 của khóa 32-byte.");
  }
  return { key, required };
}

function validateKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new TypeError("Backup encryption key must be 32 bytes.");
  }
}

function resolveBackupEncryptionConfig(options = {}) {
  const hasKey = Object.hasOwn(options, "encryptionKey");
  const hasRequired = Object.hasOwn(options, "encryptionRequired");
  const environmentConfig = hasKey
    ? null
    : loadBackupEncryptionConfig(options.env || process.env);
  const key = hasKey ? options.encryptionKey : environmentConfig.key;
  const required = hasRequired
    ? options.encryptionRequired
    : (environmentConfig?.required || false);
  if (typeof required !== "boolean") {
    throw new TypeError("Backup encryption requirement must be a boolean.");
  }
  const resolvedKey = key || null;
  if (resolvedKey) validateKey(resolvedKey);
  if (required && !resolvedKey) {
    throw new Error("BACKUP_ENCRYPTION_KEY là bắt buộc khi yêu cầu mã hóa backup.");
  }
  return { key: resolvedKey, required };
}

function encryptBuffer(plaintext, key) {
  validateKey(key);
  if (!Buffer.isBuffer(plaintext)) {
    throw new TypeError("Backup plaintext must be a Buffer.");
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

function decryptBuffer(encrypted, key) {
  validateKey(key);
  let envelope;
  try {
    envelope = JSON.parse(Buffer.isBuffer(encrypted) ? encrypted.toString("utf8") : encrypted);
  } catch {
    throw new Error("Encrypted backup envelope is invalid.");
  }
  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.algorithm !== ALGORITHM ||
    typeof envelope.iv !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Encrypted backup envelope is invalid.");
  }
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  if (
    iv.length !== IV_BYTES ||
    iv.toString("base64") !== envelope.iv ||
    authTag.length !== AUTH_TAG_BYTES ||
    authTag.toString("base64") !== envelope.authTag
  ) {
    throw new Error("Encrypted backup envelope is invalid.");
  }
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  if (ciphertext.toString("base64") !== envelope.ciphertext) {
    throw new Error("Encrypted backup envelope is invalid.");
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Backup encryption authentication failed.");
  }
}

function manifestAuthenticationTag(manifest, key) {
  const unsignedManifest = { ...manifest };
  delete unsignedManifest.authentication;
  const manifestKey = Buffer.from(crypto.hkdfSync(
    "sha256",
    key,
    Buffer.alloc(0),
    Buffer.from("booknest-backup-manifest-auth-v1"),
    KEY_BYTES,
  ));
  return crypto
    .createHmac("sha256", manifestKey)
    .update(JSON.stringify(unsignedManifest))
    .digest("base64");
}

function authenticateBackupManifest(manifest, key) {
  validateKey(key);
  return {
    ...manifest,
    authentication: {
      algorithm: "hmac-sha256",
      tag: manifestAuthenticationTag(manifest, key),
    },
  };
}

function verifyBackupManifestAuthentication(manifest, key) {
  if (
    !manifest?.authentication ||
    manifest.authentication.algorithm !== "hmac-sha256" ||
    typeof manifest.authentication.tag !== "string"
  ) {
    return false;
  }
  const actual = Buffer.from(manifest.authentication.tag, "base64");
  if (
    actual.length !== 32 ||
    actual.toString("base64") !== manifest.authentication.tag
  ) {
    return false;
  }
  const expected = Buffer.from(manifestAuthenticationTag(manifest, key), "base64");
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  authenticateBackupManifest,
  decryptBuffer,
  encryptBuffer,
  loadBackupEncryptionConfig,
  resolveBackupEncryptionConfig,
  verifyBackupManifestAuthentication,
};