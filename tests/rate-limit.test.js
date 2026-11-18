const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const { PostgresDatabase } = require("../backend/postgres-db");
const { hashOrderAccessCode } = require("../backend/order-idempotency");
const { getClientAddress } = require("../backend/security");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("getClientAddress ignores forwarded headers unless the proxy chain is trusted", () => {
  assert.equal(typeof getClientAddress, "function");
  if (typeof getClientAddress !== "function") return;

  const request = {
    socket: { remoteAddress: "198.51.100.7" },
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.4" },
  };
  assert.equal(getClientAddress(request), "198.51.100.7");
  assert.equal(getClientAddress(request, 1), "198.51.100.7");
  assert.equal(getClientAddress(request, 1, ["198.51.100.8"]), "198.51.100.7");
  assert.equal(getClientAddress(request, 1, ["198.51.100.7"]), "10.0.0.4");
  assert.equal(getClientAddress(request, 2, ["198.51.100.7"]), "203.0.113.9");
});

test("server requires an allowlist before trusting forwarded proxy headers", () => {
  assert.throws(
    () => createServer({ trustedProxyHops: 1 }),
    /RATE_LIMIT_TRUSTED_PROXY_IPS/,
  );
  assert.throws(
    () => createServer({ trustedProxyIps: "not-an-ip" }),
    /RATE_LIMIT_TRUSTED_PROXY_IPS/,
  );
});

test("file database instances share and clear local rate-limit buckets", async (t) => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-rate-limit-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const options = { usersPath: path.join(directory, "users.json") };
  const first = new Database(options);
  const second = new Database(options);

  assert.equal(typeof first.consumeRateLimit, "function");
  assert.equal(typeof second.clearRateLimit, "function");
  if (
    typeof first.consumeRateLimit !== "function" ||
    typeof second.clearRateLimit !== "function"
  ) return;
  assert.equal((await first.consumeRateLimit("bucket-digest", 1, 1000, 0)).allowed, true);
  assert.equal((await second.consumeRateLimit("bucket-digest", 1, 1000, 0)).allowed, false);
  await second.clearRateLimit("bucket-digest");
  assert.equal((await first.consumeRateLimit("bucket-digest", 1, 1000, 0)).allowed, true);
});

test("PostgresDatabase consumes rate-limit buckets with one atomic upsert", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return {
        rows: [{ count: 6, reset_at_ms: "9000" }],
        rowCount: 1,
      };
    },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  assert.equal(typeof db.consumeRateLimit, "function");
  if (typeof db.consumeRateLimit !== "function") return;
  const bucketKey = "a".repeat(64);
  const result = await db.consumeRateLimit(bucketKey, 5, 15_000, 1_000);

  assert.deepEqual(result, {
    allowed: false,
    count: 6,
    remaining: 0,
    resetAt: 9000,
  });
  assert.match(queries[0].sql, /INSERT INTO shared_rate_limits/);
  assert.match(queries[0].sql, /ON CONFLICT\s*\(bucket_key\)\s*DO UPDATE/i);
  assert.deepEqual(queries[0].values, [bucketKey, 5, 15_000, 1_000]);
});

test("PostgresDatabase clears a successful authentication bucket", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  t.after(() => db.close());

  assert.equal(typeof db.clearRateLimit, "function");
  if (typeof db.clearRateLimit !== "function") return;
  await db.clearRateLimit("a".repeat(64));
  assert.match(queries[0].sql, /DELETE FROM shared_rate_limits/);
  assert.deepEqual(queries[0].values, ["a".repeat(64)]);
});

test("two server instances share an atomic login limit and do not persist raw identities", async (t) => {
  const buckets = new Map();
  const database = {
    async consumeRateLimit(bucketKey, limit, windowMs, now) {
      const current = buckets.get(bucketKey);
      const record = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...current, count: current.count + 1 };
      buckets.set(bucketKey, record);
      return {
        allowed: record.count <= limit,
        count: record.count,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt,
      };
    },
    async clearRateLimit(bucketKey) {
      buckets.delete(bucketKey);
    },
    async getCustomBooks() {
      return [];
    },
    async findUserByEmail() {
      return null;
    },
  };
  const servers = [createServer({ database }), createServer({ database })];
  const urls = [];
  try {
    for (const server of servers) urls.push(await listen(server));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${urls[attempt % urls.length]}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "private@example.test", password: "wrong-password" }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${urls[1]}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "private@example.test", password: "wrong-password" }),
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.ok([...buckets.keys()].every((key) => (
      !key.includes("127.0.0.1") && !key.includes("private@example.test")
    )));
  } finally {
    await Promise.all(servers.map(close));
  }
});

test("guest order status lookup is rate limited across server instances", async (t) => {
  const buckets = new Map();
  const accessCode = "a1".repeat(32);
  const database = {
    async consumeRateLimit(bucketKey, limit, windowMs, now) {
      const current = buckets.get(bucketKey);
      const record = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...current, count: current.count + 1 };
      buckets.set(bucketKey, record);
      return {
        allowed: record.count <= limit,
        count: record.count,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt,
      };
    },
    async findOrderById(orderId) {
      return {
        orderId,
        userId: null,
        accessCodeHash: hashOrderAccessCode(accessCode),
        paymentStatus: "pending",
        status: "received",
      };
    },
    async getCustomBooks() {
      return [];
    },
  };
  const servers = [createServer({ database }), createServer({ database })];
  const urls = [];
  const orderId = "11111111-1111-4111-8111-111111111111";
  try {
    for (const server of servers) urls.push(await listen(server));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(
        `${urls[attempt % urls.length]}/api/orders/${orderId}/status`,
        { headers: { "X-Order-Access-Code": accessCode } },
      );
      assert.equal(response.status, 200);
    }
    const limited = await fetch(`${urls[1]}/api/orders/${orderId}/status`, {
      headers: { "X-Order-Access-Code": accessCode },
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    await Promise.all(servers.map(close));
  }
});

test("order creation attempts share the per-source limit across server instances", async (t) => {
  const buckets = new Map();
  const database = {
    async consumeRateLimit(bucketKey, limit, windowMs, now) {
      const current = buckets.get(bucketKey);
      const record = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...current, count: current.count + 1 };
      buckets.set(bucketKey, record);
      return {
        allowed: record.count <= limit,
        count: record.count,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt,
      };
    },
    async getCustomBooks() {
      return [];
    },
  };
  const servers = [createServer({ database }), createServer({ database })];
  const urls = [];
  try {
    for (const server of servers) urls.push(await listen(server));
    const attempt = (url) => fetch(`${url}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    for (let count = 0; count < 30; count += 1) {
      assert.equal((await attempt(urls[count % urls.length])).status, 400);
    }
    const limited = await attempt(urls[0]);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    await Promise.all(servers.map(close));
  }
});

test("rate-limit storage failures return a generic 503 without logging identities", async (t) => {
  const secretEmail = "do-not-log@example.test";
  const secretAddress = "198.51.100.33";
  const database = {
    async consumeRateLimit() {
      const error = new Error(`${secretEmail} ${secretAddress}`);
      error.code = "ECONNREFUSED";
      throw error;
    },
    async getCustomBooks() {
      return [];
    },
  };
  const server = createServer({ database });
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(String(message));
  try {
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: secretEmail, password: "wrong-password" }),
    });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), new RegExp(secretEmail));
    assert.doesNotMatch(messages.join("\n"), new RegExp(secretEmail));
    assert.doesNotMatch(messages.join("\n"), new RegExp(secretAddress));
    assert.match(messages.join("\n"), /rate_limit_store_failure/);
  } finally {
    console.error = originalError;
    await close(server);
  }
});
