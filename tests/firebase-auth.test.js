const assert = require("node:assert/strict");
const test = require("node:test");
const { createFirebaseIdTokenVerifier } = require("../backend/firebase-auth");

test("Firebase verifier chooses a verified Google or Facebook identity", async () => {
  const verifier = createFirebaseIdTokenVerifier({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      assert.match(url, /accounts:lookup\?key=test-key$/);
      assert.deepEqual(JSON.parse(options.body), { idToken: "test-token" });
      return {
        ok: true,
        async json() {
          return {
            users: [{
              localId: "firebase-user-id",
              email: "verified@example.com",
              emailVerified: true,
              providerUserInfo: [
                { providerId: "password" },
                { providerId: "google.com" },
              ],
            }],
          };
        },
      };
    },
  });

  assert.deepEqual(await verifier("test-token"), {
    uid: "firebase-user-id",
    email: "verified@example.com",
    name: "",
    emailVerified: true,
    provider: "google.com",
  });
});

test("Firebase verifier rejects unverified email and unsupported providers", async () => {
  const createVerifier = (user) => createFirebaseIdTokenVerifier({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { users: [user] };
      },
    }),
  });

  await assert.rejects(
    createVerifier({
      localId: "user-1",
      email: "unverified@example.com",
      emailVerified: false,
      providerUserInfo: [{ providerId: "google.com" }],
    })("token"),
    /Email.*chưa được xác minh/,
  );
  await assert.rejects(
    createVerifier({
      localId: "user-2",
      email: "unsupported@example.com",
      emailVerified: true,
      providerUserInfo: [{ providerId: "password" }],
    })("token"),
    /nhà cung cấp social được hỗ trợ/,
  );
});
