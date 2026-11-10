const { ROLES } = require("./business-constants");

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: Object.freeze([
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
    "write:users",
    "read:staff",
    "write:staff",
    "read:customers",
    "write:customers",
    "delete:customers",
  ]),
  sales: Object.freeze([
    "read:dashboard",
    "read:orders",
    "write:orders",
    "read:services",
    "write:services",
    "read:customers",
    "write:customers",
  ]),
  support: Object.freeze([
    "read:services",
    "write:services",
    "read:customers",
    "write:customers",
  ]),
  [ROLES.USER]: Object.freeze([]),
});

const CUSTOMER_ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: Object.freeze([
    "view", "create", "update", "delete",
    "interaction:view", "interaction:create", "interaction:update", "interaction:delete",
  ]),
  sales: Object.freeze([
    "view", "create", "update",
    "interaction:view", "interaction:create", "interaction:update",
  ]),
  support: Object.freeze(["view", "interaction:view", "interaction:create"]),
});

async function authenticate(request, sessionStore, RequestError) {
  const authHeader = request.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const user = await sessionStore.getSession(token);
  if (!user) throw new RequestError(401, "Chưa đăng nhập.");
  return user;
}

async function requireRole(request, permission, sessionStore, RequestError) {
  const user = await authenticate(request, sessionStore, RequestError);
  const role = String(user.role || ROLES.USER).trim().toLowerCase();
  if (!ROLE_PERMISSIONS[role]?.includes(permission)) {
    throw new RequestError(403, "Bạn không có quyền thực hiện hành động này.");
  }
  return user;
}

async function requireCustomerPermission(request, permission, sessionStore, RequestError) {
  const user = await authenticate(request, sessionStore, RequestError);
  if (!CUSTOMER_ROLE_PERMISSIONS[user.role]?.includes(permission)) {
    const messages = {
      view: "Bạn không có quyền xem dữ liệu khách hàng.",
      create: "Bạn không có quyền tạo khách hàng.",
      update: "Bạn không có quyền cập nhật khách hàng.",
      delete: "Bạn không có quyền xoá khách hàng.",
      "interaction:view": "Bạn không có quyền xem lịch sử chăm sóc khách hàng.",
      "interaction:create": "Bạn không có quyền ghi nhận tương tác khách hàng.",
      "interaction:update": "Bạn không có quyền cập nhật tương tác khách hàng.",
      "interaction:delete": "Bạn không có quyền xoá tương tác khách hàng.",
    };
    throw new RequestError(403, messages[permission]);
  }
  return user;
}

function hasPermission(user, permission) {
  const role = String(user?.role || ROLES.USER).trim().toLowerCase();
  return ROLE_PERMISSIONS[role]?.includes(permission) === true;
}

module.exports = {
  CUSTOMER_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  authenticate,
  hasPermission,
  requireCustomerPermission,
  requireRole,
};
