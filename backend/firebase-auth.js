const { SOCIAL_PROVIDERS } = require("./db");

const FIREBASE_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

function decodeBase64UrlJson(segment) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json);
}

function assertValidFirebaseJwtClaims(idToken, { projectId = "", nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) {
    if (projectId) {
      throw new Error("Firebase ID Token không đúng định dạng JWT.");
    }
    return;
  }
  let header;
  let payload;
  try {
    header = decodeBase64UrlJson(parts[0]);
    payload = decodeBase64UrlJson(parts[1]);
  } catch {
    throw new Error("Firebase ID Token không hợp lệ.");
  }
  if (!header || header.alg !== "RS256" || !parts[2]) {
    throw new Error("Thuật toán ký Firebase ID Token không được phép.");
  }
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    throw new Error("Firebase ID Token đã hết hạn.");
  }
  if (projectId) {
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer || payload.aud !== projectId) {
      throw new Error("Issuer hoặc audience của Firebase ID Token không hợp lệ.");
    }
  }
}

function createFirebaseIdTokenVerifier({
  apiKey = process.env.FIREBASE_API_KEY,
  projectId = process.env.FIREBASE_PROJECT_ID || "",
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function verifyFirebaseIdToken(idToken) {
    if (!apiKey) {
      throw new Error("FIREBASE_API_KEY phải được cấu hình để bật đăng nhập social.");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("Môi trường chạy không hỗ trợ fetch để xác minh Firebase.");
    }
    assertValidFirebaseJwtClaims(idToken, { projectId });
    const response = await fetchImpl(`${FIREBASE_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.users) || !result.users[0]) {
      throw new Error("Firebase ID Token không hợp lệ hoặc đã hết hạn.");
    }
    const firebaseUser = result.users[0];
    if (firebaseUser.emailVerified !== true) {
      throw new Error("Email của tài khoản social chưa được xác minh.");
    }
    const providerInfo = Array.isArray(firebaseUser.providerUserInfo)
      ? firebaseUser.providerUserInfo.find((entry) => SOCIAL_PROVIDERS.has(entry.providerId))
      : null;
    if (!providerInfo) {
      throw new Error("Tài khoản không sử dụng nhà cung cấp social được hỗ trợ.");
    }
    return {
      uid: firebaseUser.localId,
      email: firebaseUser.email,
      name: firebaseUser.displayName || "",
      emailVerified: true,
      provider: providerInfo?.providerId || "firebase",
    };
  };
}

module.exports = { assertValidFirebaseJwtClaims, createFirebaseIdTokenVerifier };
