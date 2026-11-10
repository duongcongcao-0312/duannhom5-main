const routes = [
  { name: "health", method: "GET", match: (path) => path === "/health" },
  { name: "ready", method: "GET", match: (path) => path === "/ready" },
  { name: "coupon:get", method: "GET", match: (path) => /^\/api\/coupons\/[A-Za-z0-9_-]+$/.test(path) },
  { name: "auth", match: (path) => path.startsWith("/api/auth/") },
  { name: "customers", match: (path) => /^\/api\/(?:admin\/)?customers(?:\/[0-9a-f-]{36})?$/.test(path) },
  { name: "customer-interactions", match: (path) => /^\/api\/(?:admin\/)?customers\/[0-9a-f-]{36}\/interactions(?:\/[0-9a-f-]{36})?$/i.test(path) },
  { name: "orders", match: (path) => /^\/api\/orders(?:\/[0-9a-f-]+)?$/.test(path) },
  { name: "services", match: (path) => path.startsWith("/api/services") },
  { name: "books", method: "GET", match: (path) => path === "/api/books" },
  { name: "admin", permission: "read:dashboard", match: (path) => path === "/api/admin/stats" },
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
  { name: "admin:users", permission: "read:users", method: "GET", match: (path) => path === "/api/admin/users" },
  { name: "admin:customers", permission: "read:customers", method: "GET", match: (path) => path === "/api/admin/customers" },
  { name: "admin:customers:create", permission: "write:customers", method: "POST", match: (path) => path === "/api/admin/customers" },
  { name: "admin:customer:update", permission: "read:customers", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:delete", permission: "delete:customers", method: "DELETE", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interactions", permission: "read:customers", method: "GET", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions$/i.test(path) },
  { name: "admin:customer:interactions:create", permission: "write:customers", method: "POST", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions$/i.test(path) },
  { name: "admin:customer:interaction:update", permission: "write:customers", method: "PATCH", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interaction:update", permission: "write:customers", method: "PUT", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
  { name: "admin:customer:interaction:delete", permission: "delete:customers", method: "DELETE", match: (path) => /^\/api\/admin\/customers\/[0-9a-f-]{36}\/interactions\/[0-9a-f-]{36}$/i.test(path) },
];

function findRoute(pathname, method) {
  return routes.find((route) => route.match(pathname) && (!route.method || route.method === method)) || null;
}

function getAdminPermission(pathname, method) {
  const candidates = routes.filter((route) => (
    route.permission &&
    route.match(pathname) &&
    (!route.method || route.method === method)
  ));
  return candidates.find((route) => route.method === method)?.permission
    || candidates[0]?.permission
    || null;
}

module.exports = { findRoute, getAdminPermission, routes };
