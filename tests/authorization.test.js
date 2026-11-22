const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CUSTOMER_ROLE_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_PERMISSIONS,
  canAccessResource,
  hasPermission,
  requireCustomerPermission,
  requireRole,
} = require("../backend/authorization");
const { routes } = require("../backend/router");

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
    "read:staff",
    "write:staff",
    "read:customers",
    "write:customers",
    "delete:customers",
  ];
  for (const permission of permissions) {
    assert.equal(hasPermission({ role: "admin" }, permission), true);
    assert.equal(hasPermission({ role: "ADMIN" }, permission), true);
  }
  assert.equal(hasPermission({ role: "sales" }, "read:users"), false);
  assert.equal(hasPermission({ role: "Sales" }, "read:users"), false);
  assert.equal(hasPermission({ role: "sales" }, "read:staff"), false);
  assert.equal(hasPermission({ role: "support" }, "write:staff"), false);
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
  await assert.rejects(
    requireRole(requestFor(sales), "write:staff", sessionStore(sales), TestRequestError),
    (error) => error.status === 403,
  );
});

test("customer policy matrix separates sales, support and destructive access", async () => {
  const sales = { role: "sales" };
  const support = { role: "support" };
  const user = { role: "user" };
  const admin = { role: "ADMIN" };
  assert.equal(
    await requireCustomerPermission(requestFor(sales), "update", sessionStore(sales), TestRequestError),
    sales,
  );
  assert.equal(
    await requireCustomerPermission(requestFor(admin), "delete", sessionStore(admin), TestRequestError),
    admin,
  );
  assert.equal(
    await requireCustomerPermission(requestFor(support), "view", sessionStore(support), TestRequestError),
    support,
  );
  assert.equal(
    await requireCustomerPermission(
      requestFor(support),
      "interaction:create",
      sessionStore(support),
      TestRequestError,
    ),
    support,
  );
  await assert.rejects(
    requireCustomerPermission(
      requestFor(support),
      "interaction:update",
      sessionStore(support),
      TestRequestError,
    ),
    (error) => error.status === 403,
  );
  await assert.rejects(
    requireCustomerPermission(
      requestFor(support),
      "interaction:delete",
      sessionStore(support),
      TestRequestError,
    ),
    (error) => error.status === 403,
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

test("PERMISSION_MATRIX defines complete Role x Resource x Action rules and stays synchronized with router, RBAC permissions, and documentation", () => {
  const expectedRoles = ["admin", "sales", "support", "user"];
  const expectedResources = [
    "dashboard",
    "orders",
    "services",
    "products",
    "coupons",
    "customers",
    "customer_interactions",
    "profiles_and_addresses",
    "privacy_and_dsar",
    "staff",
    "audit",
  ];

  // 1. Complete structure and frozen immutability
  assert.deepEqual(Object.keys(PERMISSION_MATRIX).sort(), [...expectedResources].sort());
  for (const resource of expectedResources) {
    assert.ok(Object.isFrozen(PERMISSION_MATRIX[resource]), `${resource} matrix must be frozen`);
    for (const role of expectedRoles) {
      const entry = PERMISSION_MATRIX[resource][role];
      assert.ok(entry, `Missing matrix entry for ${role} on ${resource}`);
      assert.equal(typeof entry.read, "boolean");
      assert.equal(typeof entry.write, "boolean");
      assert.equal(typeof entry.delete, "boolean");
      assert.ok(Array.isArray(entry.exceptions));
    }
  }

  // 2. Allowed & denied checks via canAccessResource (including unknown role/resource/action fail-closed)
  assert.equal(canAccessResource({ role: "admin" }, "products", "delete"), true);
  assert.equal(canAccessResource({ role: "admin" }, "audit", "read"), true);
  assert.equal(canAccessResource({ role: "admin" }, "audit", "delete"), false);
  assert.equal(canAccessResource({ role: "sales" }, "orders", "write"), true);
  assert.equal(canAccessResource({ role: "sales" }, "products", "write"), false);
  assert.equal(canAccessResource({ role: "sales" }, "customers", "delete"), false);
  assert.equal(canAccessResource({ role: "support" }, "services", "write"), true);
  assert.equal(canAccessResource({ role: "support" }, "customers", "read"), true);
  assert.equal(canAccessResource({ role: "support" }, "customers", "write"), false);
  assert.equal(canAccessResource({ role: "support" }, "customer_interactions", "write"), true);
  assert.equal(canAccessResource({ role: "support" }, "orders", "read"), false);
  assert.equal(canAccessResource({ role: "user" }, "orders", "read"), true);
  assert.equal(canAccessResource({ role: "user" }, "dashboard", "read"), false);
  assert.equal(canAccessResource({ role: "user" }, "staff", "read"), false);
  assert.equal(canAccessResource({ role: "unknown" }, "products", "read"), false);
  assert.equal(canAccessResource({ role: "admin" }, "nonexistent", "read"), false);
  assert.equal(canAccessResource({ role: "admin" }, "products", "execute"), false);
  assert.equal(canAccessResource(null, "products", "read"), false);

  // 3. Synchronized with ROLE_PERMISSIONS, CUSTOMER_ROLE_PERMISSIONS, and router.js admin routes
  const allAdminPermissions = new Set(ROLE_PERMISSIONS.admin);
  for (const route of routes) {
    if (route.permission) {
      assert.ok(
        allAdminPermissions.has(route.permission),
        `Router permission "${route.permission}" on route "${route.name}" must exist in ROLE_PERMISSIONS.admin`,
      );
    }
  }
  assert.equal(CUSTOMER_ROLE_PERMISSIONS.support.includes("create"), false);
  assert.equal(CUSTOMER_ROLE_PERMISSIONS.support.includes("update"), false);
  assert.equal(CUSTOMER_ROLE_PERMISSIONS.support.includes("delete"), false);
  assert.equal(CUSTOMER_ROLE_PERMISSIONS.sales.includes("delete"), false);
  assert.equal(CUSTOMER_ROLE_PERMISSIONS.user, undefined);

  // 4. Synchronized with docs/authorization.md
  const docText = fs.readFileSync(path.join(__dirname, "..", "docs", "authorization.md"), "utf8");
  for (const resource of expectedResources) {
    assert.ok(
      docText.includes(`\`${resource}\``),
      `docs/authorization.md must document resource "${resource}"`,
    );
  }
});
