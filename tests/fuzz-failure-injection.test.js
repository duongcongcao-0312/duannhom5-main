const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function withServer(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-rp16-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
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
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, directory };
}

function configureTestAdmin(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "fuzz-test-admin-password";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("fuzzed JSON bodies and checkout quantities fail safely while valid checkout remains compatible", async (t) => {
  const { baseUrl } = await withServer(t);
  const post = (body) => fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  for (const body of ["{", "[", "null", "[]", '"text"', "true", "{\"items\":]"]) {
    const response = await post(body);
    assert.equal(response.status, 400, `JSON input ${JSON.stringify(body)}`);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(typeof (await response.json()).error, "string");
  }

  const submit = (quantity, couponCode = "BOOKNEST10") => post(JSON.stringify({
    customerName: "RP16 Reader",
    address: "12 Đường Sách",
    phone: "0901234567",
    paymentMethod: "cod",
    discountRate: 0,
    couponCode,
    items: [{ title: "Nhà giả kim", quantity }],
  }));
  for (const quantity of [null, "1", 0, -1, 1.2, Number.MAX_SAFE_INTEGER, {}, []]) {
    assert.equal((await submit(quantity)).status, 400, `quantity ${JSON.stringify(quantity)}`);
  }
  for (const coupon of ["NO SUCH COUPON", 42, {}, "A".repeat(300)]) {
    assert.equal((await submit(1, coupon)).status, 400, `coupon ${JSON.stringify(coupon)}`);
  }
  const sanitizedCoupon = await submit(1, "<script>");
  assert.equal(sanitizedCoupon.status, 201);
  assert.equal((await sanitizedCoupon.json()).couponCode, null);
  const success = await submit(1, "booknest10");
  assert.equal(success.status, 201);
  const result = await success.json();
  assert.equal(result.couponCode, "BOOKNEST10");
  assert.equal(result.items[0].quantity, 1);
});

test("fuzzed emails, reset tokens, static paths and order statuses stay within API contracts", async (t) => {
  configureTestAdmin(t);
  const { baseUrl } = await withServer(t, { appBaseUrl: "https://shop.example/" });
  const jsonPost = (url, value) => fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

  for (const email of [null, "no-at-sign", "a@b", "<script>a@b.com</script>",
    "x".repeat(250) + "@example.com", {}, []]) {
    assert.equal((await jsonPost("/api/auth/password-reset", { email })).status, 400,
      `email ${JSON.stringify(email)}`);
  }
  for (const token of ["", "a", "g".repeat(64), "f".repeat(65), "f".repeat(64) + "\n", {}]) {
    const response = await jsonPost("/api/auth/password-reset/confirm", {
      token,
      password: "valid-password",
    });
    assert.equal(response.status, 400, `reset token ${JSON.stringify(token)}`);
  }

  for (const pathname of ["/%2e%2e/.env.example", "/%2e%2e/data/users.json", "/.git/config",
    "/%E0%A4%A", "/assets/%2e%2e/.env.example"]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.ok([400, 404].includes(response.status), `path ${pathname}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /ADMIN_PASSWORD|remote "origin"/i);
  }
  assert.equal((await fetch(`${baseUrl}/index.html`)).status, 200);

  const login = await jsonPost("/api/auth/login", {
    email: "admin@booknest.vn",
    password: "fuzz-test-admin-password",
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  for (const invalid of ["invalid-token", "x".repeat(4096), "Bearer", "null", "../admin"]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${invalid}` },
    });
    assert.equal(response.status, 401, `session token ${invalid.slice(0, 20)}`);
  }
  assert.equal((await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })).status, 200);

  const orderResponse = await jsonPost("/api/orders", {
    customerName: "RP16 Reader",
    address: "12 Đường Sách",
    phone: "0901234567",
    paymentMethod: "cod",
    discountRate: 0,
    items: [{ title: "Nhà giả kim", quantity: 1 }],
  });
  const order = await orderResponse.json();
  for (const status of ["pending", "shipped", "COMPLETED", "<script>", "", null, {}, "x".repeat(512)]) {
    const response = await fetch(`${baseUrl}/api/admin/orders/${order.orderId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    assert.equal(response.status, 400, `status ${JSON.stringify(status)}`);
  }
  const validStatus = await fetch(`${baseUrl}/api/admin/orders/${order.orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(validStatus.status, 200);
});

test("email provider failure clears the reset token and returns a sanitized service error", async (t) => {
  const { baseUrl, directory } = await withServer(t, {
    appBaseUrl: "https://shop.example/",
    passwordResetMailer: {
      async sendPasswordReset() { throw new Error("injected provider HTTP 500"); },
    },
  });
  const post = (url, value) => fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const registered = await post("/api/auth/register", {
    name: "RP16 User",
    email: "rp16@example.com",
    password: "rp16-password-123",
  });
  assert.equal(registered.status, 201);
  const failed = await post("/api/auth/password-reset", { email: "rp16@example.com" });
  assert.equal(failed.status, 503);
  const responseBody = await failed.json();
  assert.match(responseBody.error, /không thể gửi email/i);
  assert.doesNotMatch(JSON.stringify(responseBody), /provider HTTP 500|stack/i);
  const users = JSON.parse(await fs.readFile(path.join(directory, "users.json"), "utf8"));
  assert.equal(users.find((user) => user.email === "rp16@example.com").passwordReset, undefined);
});
