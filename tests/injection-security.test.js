"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

const root = path.join(__dirname, "..");

test("frontend scripts escape dynamic HTML renders and forbid dangerous eval/document.write sinks", () => {
  const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
  assert.match(mainJs, /<option value="\$\{escapeHtml\(category\.value\)\}">\$\{escapeHtml\(category\.label\)\}<\/option>/);
  assert.match(mainJs, /data-category="\$\{escapeHtml\(category\.value\)\}"/);

  const clientFiles = [
    path.join(root, "main.js"),
    path.join(root, "admin.js"),
    path.join(root, "book-detail.js"),
    ...fs.readdirSync(path.join(root, "assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(root, "assets", name)),
  ];
  for (const filePath of clientFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /\beval\s*\(/, `${path.basename(filePath)} must not use eval()`);
    assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${path.basename(filePath)} must not use new Function()`);
    assert.doesNotMatch(source, /\bdocument\.write\s*\(/, `${path.basename(filePath)} must not use document.write()`);
  }
});

test("SQL layer uses parameterized queries and server/scripts forbid shell-based command execution", () => {
  const postgresDb = fs.readFileSync(path.join(root, "backend", "postgres-db.js"), "utf8");
  assert.match(postgresDb, /VALUES \(\$1,/);
  assert.match(postgresDb, /WHERE session_hash = \$1/);
  assert.doesNotMatch(postgresDb, /SELECT\s+\*\s+FROM\s+\w+\s+WHERE\s+\w+\s*=\s*['"]?\$\{/i);

  const serverAndScriptFiles = [
    path.join(root, "server.js"),
    ...fs.readdirSync(path.join(root, "backend"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(root, "backend", name)),
    ...fs.readdirSync(path.join(root, "backend", "routes"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(root, "backend", "routes", name)),
    ...fs.readdirSync(path.join(root, "scripts"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(root, "scripts", name)),
  ];

  for (const filePath of serverAndScriptFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /\bexecSync\s*\(/, `${path.basename(filePath)} must not call execSync()`);
    assert.doesNotMatch(source, /\b(?:child_process|require\(["'](?:node:)?child_process["']\))[\s\S]{0,120}\bexec\s*\(/, `${path.basename(filePath)} must not call exec()`);
    assert.doesNotMatch(source, /shell\s*:\s*true/, `${path.basename(filePath)} must not spawn with shell: true`);
  }
});

test("backend API neutralizes XSS, SQLi, and command injection payloads across auth, books, addresses, services, and orders", async (t) => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-injection-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    addressesPath: path.join(directory, "addresses.json"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. SQLi payloads in login & books search never bypass auth or cause 500
  const sqliLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "' OR '1'='1' --",
      password: "' OR '1'='1' --",
    }),
  });
  assert.equal(sqliLogin.status, 401);

  const sqliBooks = await fetch(
    `${baseUrl}/api/v1/books?search=${encodeURIComponent("' UNION SELECT password FROM users --")}`,
  );
  assert.ok([200, 400].includes(sqliBooks.status), `SQLi query must return 200 or 400, got ${sqliBooks.status}`);
  if (sqliBooks.status === 200) {
    assert.deepEqual(await sqliBooks.json(), []);
  }

  // 2. XSS & command injection payloads in register, address, and service are stripped/inert
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "<script>alert(1)</script>Nguyễn Văn An",
      email: "safe-inject-test@example.com",
      password: "safe-inject-password-123",
    }),
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.headers.get("x-content-type-options"), "nosniff");
  assert.ok(regRes.headers.get("content-security-policy"));
  const { token, user } = await regRes.json();
  assert.doesNotMatch(user.name, /<script|alert\(1\)/i);

  const xssAddress = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipientName: "<img src=x onerror=alert(1)>Người Nhận",
      phone: "0905123456",
      addressLine: "123 Đường Sách; $(whoami) `id` | cat /etc/passwd",
    }),
  });
  assert.equal(xssAddress.status, 201);
  const { address } = await xssAddress.json();
  assert.doesNotMatch(address.recipientName, /<img|onerror=/i);

  const xssService = await fetch(`${baseUrl}/api/v1/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      bookTitle: "javascript:alert(1) Nhà giả kim",
      name: "<b>Khách</b>",
      phone: "0905123456",
      service: "rent",
      note: "<svg onload=alert(1)>Ghi chú an toàn",
    }),
  });
  assert.equal(xssService.status, 201);
  const { request: serviceReq } = await xssService.json();
  assert.doesNotMatch(serviceReq.bookTitle, /javascript:/i);
  assert.doesNotMatch(serviceReq.name, /<b>/i);
  assert.doesNotMatch(serviceReq.note, /<svg|onload=/i);
});
