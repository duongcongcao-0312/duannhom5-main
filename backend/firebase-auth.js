const FIREBASE_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

function createFirebaseIdTokenVerifier({
  apiKey = process.env.FIREBASE_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function verifyFirebaseIdToken(idToken) {
    if (!apiKey) {
      throw new Error("FIREBASE_API_KEY phải được cấu hình để bật đăng nhập social.");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("Môi trường chạy không hỗ trợ fetch để xác minh Firebase.");
    }
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
      ? firebaseUser.providerUserInfo[0]
      : null;
    return {
      uid: firebaseUser.localId,
      email: firebaseUser.email,
      name: firebaseUser.displayName || "",
      emailVerified: true,
      provider: providerInfo?.providerId || "firebase",
    };
  };
}

module.exports = { createFirebaseIdTokenVerifier };
