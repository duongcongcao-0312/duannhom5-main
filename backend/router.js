const { resolveApiVersion } = require("./api-versioning");

const routes = [
  { name: "health", method: "GET", match: (path) => path === "/health" },
  { name: "ready", method: "GET", match: (path) => path === "/ready" },
  { name: "version", method: "GET", match: (path) => path === "/api/version" },
  { name: "coupon:get", method: "GET", match: (path) => /^\/api\/coupons\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "auth", match: (path) => path.startsWith("/api/auth/") },
  { name: "users:profile", match: (path) => /^\/api\/users\/[0-9a-f-]{36}$/i.test(path) },
  { name: "addresses", match: (path) => /^\/api\/addresses(?:\/[0-9a-f-]{36})?$/i.test(path) },
  { name: "customers", match: (path) => /^\/api\/(?:admin\/)?customers(?:\/[0-9a-f-]{36})?$/.test(path) },
  { name: "customer-interactions", match: (path) => /^\/api\/(?:admin\/)?customers\/[0-9a-f-]{36}\/interactions(?:\/[0-9a-f-]{36})?$/i.test(path) },
  { name: "orders", match: (path) => /^\/api\/orders(?:\/[0-9a-f-]+)?$/.test(path) },
  { name: "services", match: (path) => path.startsWith("/api/services") },
  { name: "books", method: "GET", match: (path) => path === "/api/books" },
  { name: "categories", method: "GET", match: (path) => path === "/api/categories" },
  { name: "authors", method: "GET", match: (path) => path === "/api/authors" },
  { name: "publishers", method: "GET", match: (path) => path === "/api/publishers" },
  { name: "admin", permission: "read:dashboard", method: "GET", match: (path) => path === "/api/admin/stats" },
  { name: "admin:monitoring", permission: "read:dashboard", method: "GET", match: (path) => path === "/api/admin/monitoring" },
  { name: "admin:orders", permission: "read:orders", method: "GET", match: (path) => path === "/api/admin/orders" },
  { name: "admin:order:update", permission: "write:orders", match: (path) => /^\/api\/admin\/orders\/[0-9a-f-]+$/i.test(path) },
  { name: "admin:services", permission: "read:services", method: "GET", match: (path) => path === "/api/admin/services" },
  { name: "admin:service:update", permission: "write:services", match: (path) => /^\/api\/admin\/services\/[0-9a-f-]+$/i.test(path) },
  { name: "admin:coupons", permission: "read:coupons", method: "GET", match: (path) => path === "/api/admin/coupons" },
  { name: "admin:coupons:create", permission: "write:coupons", method: "POST", match: (path) => path === "/api/admin/coupons" },
  { name: "admin:coupon:update", permission: "write:coupons", match: (path) => /^\/api\/admin\/coupons\/[A-Z0-9_-]{3,32}$/i.test(path) },
  { name: "admin:books", permission: "read:books", method: "GET", match: (path) => path === "/api/admin/books" },
  { name: "admin:books:create", permission: "write:books", method: "POST", match: (path) => path === "/api/admin/books" },
  { name: "admin:books", permission: "write:books", match: (path) => /^\/api\/admin\/books\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "admin:uploads:book-cover", permission: "write:books", method: "POST", match: (path) => path === "/api/admin/uploads/book-cover" },
  { name: "uploads:book-cover", method: "GET", match: (path) => /^\/api\/uploads\/book-covers\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path) },
  { name: "admin:categories", permission: "read:books", method: "GET", match: (path) => path === "/api/admin/categories" },
  { name: "admin:categories:create", permission: "write:books", method: "POST", match: (path) => path === "/api/admin/categories" },
  { name: "admin:categories", permission: "write:books", match: (path) => /^\/api\/admin\/categories\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "admin:authors", permission: "read:books", method: "GET", match: (path) => path === "/api/admin/authors" },
  { name: "admin:authors:create", permission: "write:books", method: "POST", match: (path) => path === "/api/admin/authors" },
  { name: "admin:authors", permission: "write:books", match: (path) => /^\/api\/admin\/authors\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "admin:publishers", permission: "read:books", method: "GET", match: (path) => path === "/api/admin/publishers" },
  { name: "admin:publishers:create", permission: "write:books", method: "POST", match: (path) => path === "/api/admin/publishers" },
  { name: "admin:publishers", permission: "write:books", match: (path) => /^\/api\/admin\/publishers\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "admin:users", permission: "read:users", method: "GET", match: (path) => path === "/api/admin/users" },
  { name: "admin:user:update", permission: "write:users", method: "PATCH", match: (path) => /^\/api\/admin\/users\/[0-9a-f-]+$/i.test(path) },
  { name: "admin:staff", permission: "read:staff", method: "GET", match: (path) => path === "/api/admin/staff" },
  { name: "admin:staff:create", permission: "write:staff", method: "POST", match: (path) => path === "/api/admin/staff" },
  { name: "admin:staff:update", permission: "write:staff", method: "PATCH", match: (path) => /^\/api\/admin\/staff\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:audit", permission: "read:audit", method: "GET", match: (path) => path === "/api/admin/audit" },
  { name: "admin:privacy:data-requests", permission: "read:privacy", method: "GET", match: (path) => path === "/api/admin/privacy/data-requests" },
  { name: "admin:privacy:data-request:update", permission: "write:privacy", method: "PATCH", match: (path) => /^\/api\/admin\/privacy\/data-requests\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customers", permission: "read:customers", method: "GET", match: (path) => path === "/api/admin/customers" },
  { name: "admin:customers:create", permission: "write:customers", method: "POST", match: (path) => path === "/api/admin/customers" },
  { name: "admin:customer:get", permission: "read:customers", method: "GET", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:update", permission: "write:customers", method: "PUT", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:update", permission: "write:customers", method: "PATCH", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:delete", permission: "delete:customers", method: "DELETE", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interactions", permission: "read:customers", method: "GET", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions$/i.test(path) },
  { name: "admin:customer:interactions:create", permission: "write:customers", method: "POST", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions$/i.test(path) },
  { name: "admin:customer:interaction:update", permission: "write:customers", method: "PATCH", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interaction:update", permission: "write:customers", method: "PUT", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interaction:delete", permission: "delete:customers", method: "DELETE", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
];

function normalizeRoutePath(pathname) {
  const versionInfo = resolveApiVersion(pathname);
  if (versionInfo.unsupportedVersion) return null;
  return versionInfo.canonicalPath;
}

function findRoute(pathname, method) {
  const normalizedPath = normalizeRoutePath(pathname);
  if (!normalizedPath) return null;
  return routes.find((route) => route.match(normalizedPath) && (!route.method || route.method === method)) || null;
}

function getAdminPermission(pathname, method) {
  const normalizedPath = normalizeRoutePath(pathname);
  if (!normalizedPath) return null;
  const candidates = routes.filter((route) => (
    route.permission &&
    route.match(normalizedPath) &&
    (!route.method || route.method === method)
  ));
  return candidates.find((route) => route.method === method)?.permission
    || candidates[0]?.permission
    || null;
}

module.exports = { findRoute, getAdminPermission, routes };
