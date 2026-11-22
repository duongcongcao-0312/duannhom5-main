"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createServer } = require("../server");
const {
  ENDPOINT_BODY_LIMITS,
  MAX_URL_LENGTH,
  MULTIPART_OVERHEAD_BYTES,
  UPLOAD_POLICY,
  RequestLimitError,
  assertRequestSizeHeaders,
  detectImageMimeFromMagicBytes,
  parseMultipartSingleFile,
  readBoundedBody,
  resolveRequestBodyLimit,
  resolveSafeStoredUploadPath,
  storeSafeImageUpload,
  validateImageUpload,
  validateUploadFilename,
} = require("../backend/request-limits");

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);
const VALID_WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from("VP8 ", "ascii"),
]);

function buildMultipartBody(boundary, { filename, contentType, content, fieldName = "file" }) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
      "utf8",
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "request-limits-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-req-limits-"));
  const uploadsDir = path.join(directory, "uploads", "book-covers");
  const auditLogPath = path.join(directory, "admin-audit.jsonl");
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    auditLogPath,
    uploadsDir,
    ...options,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    port: server.address().port,
    directory,
    uploadsDir,
    auditLogPath,
  };
}

function sendRawHttpRequest({ port, method = "POST", path: reqPath, headers = {}, chunks = [] }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path: reqPath, headers }, (res) => {
      const responseChunks = [];
      res.on("data", (chunk) => responseChunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(responseChunks).toString("utf8"),
        });
      });
    });
    req.on("error", (error) => {
      if (error.code === "ECONNRESET" || error.code === "EPIPE") return;
      reject(error);
    });
    for (const chunk of chunks) {
      if (req.destroyed) break;
      req.write(chunk);
    }
    req.end();
  });
}

test("endpoint body limit resolution maps every route category accurately", () => {
  assert.deepEqual(resolveRequestBodyLimit("/api/auth/login"), {
    category: "auth",
    maxBytes: ENDPOINT_BODY_LIMITS.auth,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/payments/webhook"), {
    category: "webhooks",
    maxBytes: ENDPOINT_BODY_LIMITS.webhooks,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/payments/sepay-webhook"), {
    category: "webhooks",
    maxBytes: ENDPOINT_BODY_LIMITS.webhooks,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/services"), {
    category: "services",
    maxBytes: ENDPOINT_BODY_LIMITS.services,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/privacy/consents"), {
    category: "privacy",
    maxBytes: ENDPOINT_BODY_LIMITS.privacy,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/orders"), {
    category: "orders",
    maxBytes: ENDPOINT_BODY_LIMITS.orders,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/customers"), {
    category: "customers",
    maxBytes: ENDPOINT_BODY_LIMITS.customers,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/admin/books"), {
    category: "admin",
    maxBytes: ENDPOINT_BODY_LIMITS.admin,
  });
  assert.deepEqual(resolveRequestBodyLimit("/api/admin/uploads/book-cover", { contentType: "image/png" }), {
    category: "upload",
    maxFileBytes: ENDPOINT_BODY_LIMITS.upload,
    maxBytes: ENDPOINT_BODY_LIMITS.upload,
  });
  assert.deepEqual(
    resolveRequestBodyLimit("/api/admin/uploads/book-cover", { contentType: "multipart/form-data; boundary=abc" }),
    {
      category: "upload",
      maxFileBytes: ENDPOINT_BODY_LIMITS.upload,
      maxBytes: ENDPOINT_BODY_LIMITS.upload + MULTIPART_OVERHEAD_BYTES,
    },
  );
  assert.deepEqual(resolveRequestBodyLimit("/api/unknown"), {
    category: "default",
    maxBytes: ENDPOINT_BODY_LIMITS.default,
  });
});

test("header validation and bounded stream reader enforce exact boundaries", async () => {
  assert.doesNotThrow(() => {
    assertRequestSizeHeaders(
      { url: "/api/auth/login", headers: { "content-length": String(ENDPOINT_BODY_LIMITS.auth) } },
      "/api/auth/login",
    );
  });
  assert.throws(
    () => assertRequestSizeHeaders(
      { url: "/api/auth/login", headers: { "content-length": String(ENDPOINT_BODY_LIMITS.auth + 1) } },
      "/api/auth/login",
    ),
    (error) => error instanceof RequestLimitError && error.status === 413 && error.maxBytes === ENDPOINT_BODY_LIMITS.auth,
  );
  assert.throws(
    () => assertRequestSizeHeaders(
      { url: "/api/auth/login", headers: { "content-length": "-5" } },
      "/api/auth/login",
    ),
    (error) => error instanceof RequestLimitError && error.status === 400,
  );
  assert.throws(
    () => assertRequestSizeHeaders(
      { url: `/api/books?q=${"a".repeat(MAX_URL_LENGTH)}`, headers: {} },
      "/api/books",
    ),
    (error) => error instanceof RequestLimitError && error.status === 414,
  );

  // Stream boundary: exact limit allowed, +1 byte rejected immediately
  const exactStream = Readable.from([Buffer.alloc(32, 0x61), Buffer.alloc(32, 0x62)]);
  exactStream.headers = {};
  const exactResult = await readBoundedBody(exactStream, 64);
  assert.equal(exactResult.length, 64);

  const oversizedStream = Readable.from([Buffer.alloc(32, 0x61), Buffer.alloc(33, 0x62)]);
  oversizedStream.headers = {};
  await assert.rejects(
    () => readBoundedBody(oversizedStream, 64),
    (error) => error instanceof RequestLimitError && error.status === 413 && error.maxBytes === 64,
  );
});

test("upload validators inspect magic bytes, filenames, and isolate storage safely", async (t) => {
  assert.equal(detectImageMimeFromMagicBytes(VALID_PNG), "image/png");
  assert.equal(detectImageMimeFromMagicBytes(VALID_JPEG), "image/jpeg");
  assert.equal(detectImageMimeFromMagicBytes(VALID_WEBP), "image/webp");
  assert.equal(detectImageMimeFromMagicBytes(Buffer.from("<svg><script>alert(1)</script></svg>")), null);
  assert.equal(detectImageMimeFromMagicBytes(Buffer.from("short")), null);

  assert.equal(validateUploadFilename("book-cover_01.png", "image/png"), "book-cover_01.png");
  assert.equal(validateUploadFilename("cover.jpeg", "image/jpeg"), "cover.jpeg");

  for (const badName of [
    "../secret.png",
    "..\\secret.png",
    "dir/cover.png",
    ".hidden.png",
    "shell.php.png",
    "xss.svg.png",
    "payload.html.png",
    "bad\u0000name.png",
    "mismatch.jpg",
    `${"a".repeat(UPLOAD_POLICY.maxFilenameLength + 1)}.png`,
  ]) {
    assert.throws(
      () => validateUploadFilename(badName, "image/png"),
      (error) => error instanceof RequestLimitError && error.status === 400,
      `Expected filename to be rejected: ${badName}`,
    );
  }

  // Disallowed MIME
  assert.throws(
    () => validateImageUpload({ buffer: Buffer.from("<svg/>"), declaredMime: "image/svg+xml" }),
    (error) => error instanceof RequestLimitError && error.status === 415,
  );
  // Magic-byte mismatch (HTML disguised as PNG)
  assert.throws(
    () => validateImageUpload({
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
      declaredMime: "image/png",
      filename: "fake.png",
    }),
    (error) => error instanceof RequestLimitError && error.status === 400,
  );
  // Empty file
  assert.throws(
    () => validateImageUpload({ buffer: Buffer.alloc(0), declaredMime: "image/png" }),
    (error) => error instanceof RequestLimitError && error.status === 400,
  );
  // Multipart parsing
  const boundary = "----BookNestUnitBoundary";
  const multipartRaw = buildMultipartBody(boundary, {
    filename: "cover.webp",
    contentType: "image/webp",
    content: VALID_WEBP,
  });
  const parsed = parseMultipartSingleFile(multipartRaw, `multipart/form-data; boundary=${boundary}`);
  assert.equal(parsed.filename, "cover.webp");
  assert.equal(parsed.declaredMime, "image/webp");
  assert.deepEqual(parsed.buffer, VALID_WEBP);

  // Safe storage never reuses client filename and enforces containment
  const tempUploads = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-upload-unit-"));
  t.after(() => fs.rm(tempUploads, { recursive: true, force: true }));
  const validated = validateImageUpload({
    buffer: VALID_PNG,
    declaredMime: "image/png",
    filename: "my-book-cover.png",
  });
  const stored = await storeSafeImageUpload(tempUploads, validated);
  assert.notEqual(stored.filename, "my-book-cover.png");
  assert.match(stored.filename, UPLOAD_POLICY.storageFilenamePattern);
  assert.equal(resolveSafeStoredUploadPath(tempUploads, "../escape.png"), null);
  assert.equal(resolveSafeStoredUploadPath(tempUploads, "my-book-cover.png"), null);
  const safePath = resolveSafeStoredUploadPath(tempUploads, stored.filename);
  assert.ok(safePath && safePath.mimeType === "image/png");
});

test("HTTP server enforces per-endpoint limits, exact boundaries, and early rejection before expensive work", async (t) => {
  configureAdminEnv(t);
  const { baseUrl, port } = await withServer(t);

  // 1. Auth endpoint (16 KiB limit): exact 16 KiB reaches route validation (not 413), +1 byte returns 413
  const authPrefix = '{"email":"reader@example.com","password":"';
  const authSuffix = '"}';
  const exactAuthPad = ENDPOINT_BODY_LIMITS.auth - Buffer.byteLength(authPrefix + authSuffix);
  const exactAuthBody = `${authPrefix}${"a".repeat(exactAuthPad)}${authSuffix}`;
  assert.equal(Buffer.byteLength(exactAuthBody), ENDPOINT_BODY_LIMITS.auth);

  const exactAuthResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: exactAuthBody,
  });
  assert.notEqual(exactAuthResponse.status, 413);

  const overAuthBody = `${authPrefix}${"a".repeat(exactAuthPad + 1)}${authSuffix}`;
  const overAuthResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: overAuthBody,
  });
  assert.equal(overAuthResponse.status, 413);
  const overAuthJson = await overAuthResponse.json();
  assert.equal(overAuthJson.code, "PAYLOAD_TOO_LARGE");
  assert.equal(overAuthJson.maxBytes, ENDPOINT_BODY_LIMITS.auth);

  // 2. Early rejection via Content-Length BEFORE auth/rate-limit/signature work
  // Even without valid webhook secret/signature, oversized Content-Length gets 413 immediately
  const earlyWebhook = await sendRawHttpRequest({
    port,
    method: "POST",
    path: "/api/payments/webhook",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(ENDPOINT_BODY_LIMITS.webhooks + 1),
    },
    chunks: [Buffer.from("{}")],
  });
  assert.equal(earlyWebhook.status, 413);
  assert.equal(JSON.parse(earlyWebhook.body).maxBytes, ENDPOINT_BODY_LIMITS.webhooks);

  // Oversized Content-Length on /api/auth/login does NOT trigger login rate-limit (sent 25 times, then valid login succeeds)
  for (let i = 0; i < 15; i += 1) {
    const res = await sendRawHttpRequest({
      port,
      method: "POST",
      path: "/api/auth/login",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(ENDPOINT_BODY_LIMITS.auth + 100),
      },
      chunks: [Buffer.from("{}")],
    });
    assert.equal(res.status, 413);
  }
  const validLoginAfterOversized = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "request-limits-admin-pass-123",
    }),
  });
  assert.equal(validLoginAfterOversized.status, 200);
  const { token: adminToken } = await validLoginAfterOversized.json();

  // 3. Streaming / chunked oversized body (no Content-Length) rejected with 413
  const chunkedOversized = await sendRawHttpRequest({
    port,
    method: "POST",
    path: "/api/orders",
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    },
    chunks: [
      Buffer.from(`{"customerName":"${"A".repeat(40000)}`),
      Buffer.from(`${"B".repeat(30000)}"}`),
    ],
  });
  assert.equal(chunkedOversized.status, 413);
  assert.equal(JSON.parse(chunkedOversized.body).maxBytes, ENDPOINT_BODY_LIMITS.orders);

  // 4. Admin endpoint allows > 64 KiB (up to 128 KiB) but rejects > 128 KiB
  const overAdmin = await fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ title: "Big Book", description: "x".repeat(ENDPOINT_BODY_LIMITS.admin + 100) }),
  });
  assert.equal(overAdmin.status, 413);
  assert.equal((await overAdmin.json()).maxBytes, ENDPOINT_BODY_LIMITS.admin);

  // 5. Overly long URL rejected with 414
  const longUrl = await fetch(`${baseUrl}/api/books?q=${"a".repeat(MAX_URL_LENGTH)}`);
  assert.equal(longUrl.status, 414);

  // 6. Valid normal order request still succeeds
  const validOrder = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Nguyễn Văn Hợp Lệ",
      address: "12 Đường Sách, Quận 1",
      phone: "0901234567",
      paymentMethod: "cod",
      accessCode: "a1".repeat(32),
      discountRate: 0,
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(validOrder.status, 201);
});

test("admin book cover upload enforces auth, MIME allowlist, magic bytes, safe filenames, size limits, and sandboxed serving", async (t) => {
  configureAdminEnv(t);
  const uploadMaxBytes = 4096; // 4 KiB custom limit for fast boundary tests
  const { baseUrl, uploadsDir } = await withServer(t, { uploadMaxBytes });

  // Unauthenticated upload rejected with 401
  const unauthUpload = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: VALID_PNG,
  });
  assert.equal(unauthUpload.status, 401);

  // Regular user rejected with 403
  const userReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Normal Reader",
      email: "reader-upload@example.com",
      password: "reader-password-123",
    }),
  });
  assert.equal(userReg.status, 201);
  const { token: userToken } = await userReg.json();
  const forbiddenUpload = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "image/png",
    },
    body: VALID_PNG,
  });
  assert.equal(forbiddenUpload.status, 403);

  // Login as admin
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@booknest.vn",
      password: "request-limits-admin-pass-123",
    }),
  });
  assert.equal(adminLogin.status, 200);
  const { token: adminToken } = await adminLogin.json();

  // Disallowed MIME types (SVG, HTML, octet-stream) rejected with 415
  for (const badMime of ["image/svg+xml", "text/html", "application/javascript", "application/octet-stream"]) {
    const res = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": badMime,
      },
      body: Buffer.from("<svg><script>alert(1)</script></svg>"),
    });
    assert.equal(res.status, 415, `MIME ${badMime} should return 415`);
  }

  // Spoofed MIME (HTML/script disguised as image/png) rejected with 400
  const spoofedRes = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "image/png",
      "X-File-Name": "cover.png",
    },
    body: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  assert.equal(spoofedRes.status, 400);

  // Dangerous filenames rejected with 400
  for (const badName of ["../../etc/passwd.png", "shell.php.png", ".htaccess.png", "wrong.jpg"]) {
    const res = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "image/png",
        "X-File-Name": badName,
      },
      body: VALID_PNG,
    });
    assert.equal(res.status, 400, `Filename ${badName} should return 400`);
  }

  // Oversized raw binary upload (> uploadMaxBytes) rejected with 413
  const oversizedPng = Buffer.concat([VALID_PNG, Buffer.alloc(uploadMaxBytes - VALID_PNG.length + 1, 0x00)]);
  const overRawRes = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "image/png",
      "X-File-Name": "big.png",
    },
    body: oversizedPng,
  });
  assert.equal(overRawRes.status, 413);

  // Exact boundary raw binary upload (=== uploadMaxBytes) succeeds
  const exactPng = Buffer.concat([VALID_PNG, Buffer.alloc(uploadMaxBytes - VALID_PNG.length, 0x00)]);
  const validRawRes = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "image/png",
      "X-File-Name": "exact-cover.png",
    },
    body: exactPng,
  });
  assert.equal(validRawRes.status, 201);
  const uploadedRaw = await validRawRes.json();
  assert.match(uploadedRaw.filename, UPLOAD_POLICY.storageFilenamePattern);
  assert.equal(uploadedRaw.mimeType, "image/png");
  assert.equal(uploadedRaw.size, uploadMaxBytes);

  // Stored file is served safely with nosniff + sandbox CSP
  const served = await fetch(`${baseUrl}${uploadedRaw.url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal(served.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  const servedBuf = Buffer.from(await served.arrayBuffer());
  assert.deepEqual(servedBuf, exactPng);

  // Valid multipart/form-data JPEG upload succeeds
  const boundary = "----BookNestMultipartTest";
  const multipartValid = buildMultipartBody(boundary, {
    filename: "book-cover.jpg",
    contentType: "image/jpeg",
    content: VALID_JPEG,
  });
  const validMpRes = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartValid,
  });
  assert.equal(validMpRes.status, 201);
  const uploadedMp = await validMpRes.json();
  assert.equal(uploadedMp.mimeType, "image/jpeg");
  assert.ok(uploadedMp.filename.endsWith(".jpg"));

  // Oversized multipart file (> uploadMaxBytes) rejected with 413
  const multipartOversized = buildMultipartBody(boundary, {
    filename: "too-big.png",
    contentType: "image/png",
    content: oversizedPng,
  });
  const overMpRes = await fetch(`${baseUrl}/api/admin/uploads/book-cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartOversized,
  });
  assert.equal(overMpRes.status, 413);

  // Path traversal on GET /api/uploads/book-covers/... rejected safely
  for (const badPath of [
    "/api/uploads/book-covers/..%2F..%2F.env",
    "/api/uploads/book-covers/not-a-uuid.png",
  ]) {
    const res = await fetch(`${baseUrl}${badPath}`);
    assert.ok([400, 404].includes(res.status), `${badPath} should return 400 or 404`);
  }

  // Verify only the 2 valid files were written to disk
  const storedFiles = await fs.readdir(uploadsDir);
  assert.equal(storedFiles.length, 2);
});
