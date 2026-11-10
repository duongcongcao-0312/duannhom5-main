const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-security-test-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("static serving rejects traversal and malformed encoded paths", async (t) => {
  const baseUrl = await withServer(t);
  for (const pathname of [
    "/%2e%2e/.env",
    "/%2e%2e/data/users.json",
    "/assets/%2e%2e/%2e%2e/.git/config",
    "/%E0%A4%A",
    "/.git/config",
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.ok([400, 404].includes(response.status), `${pathname}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /ADMIN_PASSWORD|remote "origin"|BEGIN PRIVATE KEY/i);
  }
});

test("security headers are applied to static, API, and error responses", async (t) => {
  const baseUrl = await withServer(t);
  for (const pathname of ["/index.html", "/health", "/api/unknown"]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  }
});

test("authentication responses never expose passwords, reset tokens or secrets", async (t) => {
  const baseUrl = await withServer(t);
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Security Test User",
      email: "security@example.com",
      password: "security-password-123",
    }),
  });
  assert.equal(registerResponse.status, 201);
  assert.equal(registerResponse.headers.get("cache-control"), "no-store");
  const registerBody = await registerResponse.text();
  assert.doesNotMatch(registerBody, /security-password-123|passwordReset|password|salt|hash/i);
  const { token, expiresAt } = JSON.parse(registerBody);
  assert.ok(token);
  assert.ok(Number.isFinite(expiresAt));
  assert.ok(expiresAt > Date.now());

  const profileResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(profileResponse.status, 200);
  assert.doesNotMatch(await profileResponse.text(), /security-password-123|passwordReset|salt|hash/i);

  const invalidReset = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "f".repeat(64),
      password: "security-password-123",
    }),
  });
  assert.equal(invalidReset.status, 400);
  assert.doesNotMatch(await invalidReset.text(), /security-password-123|tokenHash|stack/i);
});

test("public order lookup does not disclose delivery or customer details", async (t) => {
  const baseUrl = await withServer(t);
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Buyer <script>alert(1)</script>",
      address: "Secret delivery address",
      phone: "0901234567",
      paymentMethod: "cod",
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(response.status, 201);
  const order = await response.json();
  const lookup = await fetch(`${baseUrl}/api/orders/${order.orderId}`);
  assert.equal(lookup.status, 200);
  const body = await lookup.text();
  assert.doesNotMatch(body, /<script>|alert\(1\)|Secret delivery address|0901234567/i);
  assert.match(body, /"orderId"/);
  assert.match(body, /"status"/);
});
