const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hashPassword, verifyPassword } = require("../backend/auth");
const { Database } = require("../backend/db");
const { createEmailMailer } = require("../backend/email");
const { PostgresDatabase } = require("../backend/postgres-db");
const { createServer } = require("../server");


test("email delivery uses the HTTPS provider and exposes provider errors", async () => {
  const requests = [];
  const mailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "BookNest <no-reply@example.com>" },
    async (...args) => {
      requests.push(args);
      return new Response("", { status: 202 });
    },
  );
  await mailer.sendPasswordReset({
    to: "reader@example.com",
    name: "BookNest Reader",
    url: "https://example.com/#resetToken=token",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "https://api.resend.com/emails");
  assert.equal(requests[0][1].headers.Authorization, "Bearer test-api-key");
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    from: "BookNest <no-reply@example.com>",
    to: ["reader@example.com"],
    subject: "Khôi phục mật khẩu BookNest",
    text: "Xin chào BookNest Reader,\n\nĐể đặt lại mật khẩu BookNest, hãy mở liên kết sau trong vòng 1 giờ:\nhttps://example.com/#resetToken=token\n\nNếu bạn không yêu cầu khôi phục mật khẩu, hãy bỏ qua email này.",
  });

  const failingMailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "no-reply@example.com" },
    async () => new Response("domain is not verified", { status: 403 }),
  );
  await assert.rejects(
    failingMailer.sendPasswordReset({ to: "reader@example.com", name: "Reader", url: "https://example.com/" }),
    /Resend trả về HTTP 403: domain is not verified/,
  );
});

test("email delivery retries transient Resend responses and bounds timeouts", async () => {
  let responseAttempts = 0;
  const retryingMailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "no-reply@example.com" },
    async (_url, options) => {
      responseAttempts += 1;
      assert.ok(options.signal instanceof AbortSignal);
      if (responseAttempts === 1) return new Response("rate limited", { status: 429 });
      if (responseAttempts === 2) return new Response("provider unavailable", { status: 503 });
      return new Response("", { status: 202 });
    },
  );
  await retryingMailer.sendPasswordReset({
    to: "reader@example.com",
    name: "Reader",
    url: "https://example.com/",
  });
  assert.equal(responseAttempts, 3);

  let timeoutAttempts = 0;
  const timeoutMailer = createEmailMailer(
    { RESEND_API_KEY: "test-api-key", RESEND_FROM: "no-reply@example.com" },
    async () => {
      timeoutAttempts += 1;
      const error = new Error("request timed out");
      error.name = "TimeoutError";
      throw error;
    },
  );
  await assert.rejects(
    timeoutMailer.sendPasswordReset({
      to: "reader@example.com",
      name: "Reader",
      url: "https://example.com/",
    }),
    { name: "TimeoutError" },
  );
  assert.equal(timeoutAttempts, 3);
});

test("email delivery surfaces exhausted HTTP 429 and 500 failures after bounded retries", async () => {
  for (const status of [429, 500]) {
    let attempts = 0;
    const mailer = createEmailMailer(
      { RESEND_API_KEY: "test-api-key", RESEND_FROM: "no-reply@example.com" },
      async () => {
        attempts += 1;
        return new Response(`injected HTTP ${status}`, { status });
      },
    );
    await assert.rejects(
      mailer.sendPasswordReset({
        to: "reader@example.com",
        name: "Reader",
        url: "https://example.com/",
      }),
      new RegExp(`HTTP ${status}: injected HTTP ${status}`),
    );
    assert.equal(attempts, 3, `HTTP ${status} should stop after the configured retry limit`);
  }
});

test("production server requires explicit admin credentials", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./server').createServer()"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        RENDER: "",
        DATABASE_URL: "",
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
        NODE_ENV: "production",
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production requires a valid ADMIN_EMAIL/);
});

test("Render backend refuses to start without a persistent database URL", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./server').createServer()"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        RENDER: "true",
        DATABASE_URL: "",
        NODE_ENV: "development",
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL phải được cấu hình trên Render/);
});

test("PostgreSQL uses TLS settings compatible with Render internal databases", async (t) => {
  const originalRender = process.env.RENDER;
  t.after(async () => {
    if (originalRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = originalRender;
  });

  process.env.RENDER = "true";
  const internalDatabase = new PostgresDatabase({
    connectionString: "postgres://user:password@dpg-test-a:5432/booknest",
  });
  assert.deepEqual(internalDatabase.pool.options.ssl, {
    rejectUnauthorized: false,
  });
  await internalDatabase.pool.end();

  const externalDatabase = new PostgresDatabase({
    connectionString: "postgres://user:password@dpg-test-a.oregon-postgres.render.com:5432/booknest",
  });
  assert.equal(externalDatabase.pool.options.ssl, true);
  await externalDatabase.pool.end();
});

test("configured admin credentials restore the admin account in file storage", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-admin-recovery-"),
  );
  const usersPath = path.join(temporaryDirectory, "users.json");
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  t.after(async () => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await fsPromises.writeFile(
    usersPath,
    JSON.stringify([{
      id: "admin-master",
      name: "Quản trị viên BookNest",
      email: "admin@example.com",
      password: hashPassword("old-password"),
      role: "user",
    }]),
  );
  process.env.ADMIN_EMAIL = " ADMIN@example.com ";
  process.env.ADMIN_PASSWORD = "new-admin-password-123";

  const db = new Database({ usersPath });
  await db.init();
  const admin = await db.findUserByEmail("admin@example.com");

  assert.equal(admin.role, "admin");
  assert.equal(verifyPassword("new-admin-password-123", admin.password), true);
  assert.equal(verifyPassword("old-password", admin.password), false);
});

test("file storage does not create or retain the insecure default administrator", async (t) => {
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "booknest-default-admin-removal-"),
  );
  const originalEnvironment = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  t.after(async () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const emptyDb = new Database({ usersPath: path.join(temporaryDirectory, "empty-users.json") });
  await emptyDb.init();
  assert.deepEqual(await emptyDb.getUsers(), []);

  const usersPath = path.join(temporaryDirectory, "legacy-users.json");
  await fsPromises.writeFile(usersPath, JSON.stringify([{
    id: "legacy-admin",
    email: "admin@booknest.vn",
    password: hashPassword("admin" + "123"),
    role: "admin",
  }]));
  const legacyDb = new Database({ usersPath });
  await legacyDb.init();
  const legacyAdmin = await legacyDb.findUserByEmail("admin@booknest.vn");
  assert.equal(legacyAdmin.role, "user");
  assert.equal(verifyPassword("admin" + "123", legacyAdmin.password), false);
});

test("configured admin credentials restore the admin account in PostgreSQL", async (t) => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  let records = [{
    id: "admin-master",
    email: "admin@example.com",
    password: hashPassword("old-password"),
    role: "user",
  }];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("SELECT records FROM booknest_data")) {
        return { rows: [{ records }] };
      }
      if (sql.includes("INSERT INTO booknest_data")) {
        records = JSON.parse(values[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  t.after(() => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  process.env.ADMIN_EMAIL = " ADMIN@example.com ";
  process.env.ADMIN_PASSWORD = "new-admin-password-123";

  const db = new PostgresDatabase({ pool });
  await db.init();

  assert.equal(records[0].role, "admin");
  assert.equal(
    verifyPassword("new-admin-password-123", records[0].password),
    true,
  );
  assert.equal(verifyPassword("old-password", records[0].password), false);
});
