const assert = require("node:assert/strict");
const test = require("node:test");
const {
  hasPermission,
  requireCustomerPermission,
  requireRole,
} = require("../backend/authorization");

class TestRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requestFor(session) {
  return {
    headers: { authorization: session ? "Bearer token" : "" },
  };
}

function sessionStore(session) {
  return { getSession: () => session };
}

test("role policy matrix grants only the intended admin permissions", () => {
  const permissions = [
    "read:dashboard",
    "read:orders",
    "write:orders",
    "read:services",
    "write:services",
    "read:books",
    "write:books",
    "read:coupons",
    "write:coupons",
    "read:users",
    "read:customers",
    "write:customers",
    "delete:customers",
  ];
  for (const permission of permissions) {
    assert.equal(hasPermission({ role: "admin" }, permission), true);
  }
  assert.equal(hasPermission({ role: "sales" }, "read:users"), false);
  assert.equal(hasPermission({ role: "support" }, "write:orders"), false);
  assert.equal(hasPermission({ role: "user" }, "read:orders"), false);
});

test("authentication middleware rejects missing sessions and authorizes valid roles", async () => {
  await assert.rejects(
    requireRole(requestFor(null), "read:orders", sessionStore(null), TestRequestError),
    (error) => error.status === 401,
  );
  const sales = { role: "sales" };
  assert.equal(
    await requireRole(requestFor(sales), "read:orders", sessionStore(sales), TestRequestError),
    sales,
  );
  await assert.rejects(
    requireRole(requestFor(sales), "read:users", sessionStore(sales), TestRequestError),
    (error) => error.status === 403,
  );
});

test("customer policy matrix separates sales, support and destructive access", async () => {
  const sales = { role: "sales" };
  const support = { role: "support" };
  const user = { role: "user" };
  assert.equal(
    await requireCustomerPermission(requestFor(sales), "update", sessionStore(sales), TestRequestError),
    sales,
  );
  assert.equal(
    await requireCustomerPermission(requestFor(support), "view", sessionStore(support), TestRequestError),
    support,
  );
  await assert.rejects(
    requireCustomerPermission(requestFor(support), "delete", sessionStore(support), TestRequestError),
    (error) => error.status === 403,
  );
  await assert.rejects(
    requireCustomerPermission(requestFor(user), "view", sessionStore(user), TestRequestError),
    (error) => error.status === 403,
  );
});
