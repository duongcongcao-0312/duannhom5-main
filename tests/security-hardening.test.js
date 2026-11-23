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
      accessCode: "a1".repeat(32),
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(response.status, 201);
  const order = await response.json();
  const lookup = await fetch(`${baseUrl}/api/orders/${order.orderId}`, {
    headers: { "X-Order-Access-Code": "a1".repeat(32) },
  });
  assert.equal(lookup.status, 200);
  const body = await lookup.text();
  assert.doesNotMatch(body, /<script>|alert\(1\)|Secret delivery address|0901234567/i);
  assert.match(body, /"orderId"/);
  assert.match(body, /"status"/);
});

test("CSP and HTTP security headers harden storefront, admin, and API responses without overly permissive script rules", async (t) => {
  const baseUrl = await withServer(t);
  const root = path.join(__dirname, "..");

  // Storefront & admin pages carry strict CSP, Permissions-Policy, COOP, CORP, and no HSTS on plain local HTTP
  for (const endpoint of ["/", "/admin.html", "/book.html", "/privacy.html", "/api/v1/books"]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200, `${endpoint} should return 200`);
    const csp = res.headers.get("content-security-policy") || "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self' https:\/\/www\.gstatic\.com/);
    const scriptDirective = csp.split(";").find((part) => part.trim().startsWith("script-src")) || "";
    assert.doesNotMatch(scriptDirective, /'unsafe-inline'|'unsafe-eval'|\*/, "script-src must not allow unsafe-inline, unsafe-eval, or wildcard");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(res.headers.get("permissions-policy") || "", /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
    assert.equal(res.headers.get("cross-origin-resource-policy"), "same-site");
    assert.equal(res.headers.get("strict-transport-security"), null, "HSTS must not be emitted on local plain HTTP");
  }

  // HSTS is emitted when running in production behind HTTPS reverse proxy
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  const httpsRes = await fetch(`${baseUrl}/health`, {
    headers: { "X-Forwarded-Proto": "https" },
  });
  assert.equal(httpsRes.status, 200);
  assert.equal(
    httpsRes.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );

  // Storefront & admin HTML contain zero inline <script> blocks or inline event handlers
  for (const page of ["index.html", "admin.html", "book.html", "privacy.html"]) {
    const html = await fs.readFile(path.join(root, page), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, `${page} must not contain inline <script> blocks`);
    assert.doesNotMatch(html, /\bon(?:click|load|error|submit|change)\s*=/i, `${page} must not contain inline event handlers`);
  }
});
