const { ROLES, normalizeRole } = require("./business-constants");

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
    "read:privacy",
    "write:privacy",
    "read:audit",
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
  const role = normalizeRole(user.role);
  if (!ROLE_PERMISSIONS[role]?.includes(permission)) {
    throw new RequestError(403, "Bạn không có quyền thực hiện hành động này.");
  }
  return user;
}

async function requireCustomerPermission(request, permission, sessionStore, RequestError) {
  const user = await authenticate(request, sessionStore, RequestError);
  const role = normalizeRole(user.role);
  if (!CUSTOMER_ROLE_PERMISSIONS[role]?.includes(permission)) {
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

const SENSITIVE_OPERATIONS_CATALOG = Object.freeze({
  account_data: Object.freeze({
    description: "Dữ liệu tài khoản, liên kết social, consent, DSAR và xuất dữ liệu cá nhân",
    endpoints: Object.freeze([
      "GET /api/v1/auth/me",
      "PATCH /api/v1/auth/customer-info",
      "POST /api/v1/auth/social/link",
      "POST /api/v1/auth/social/unlink",
      "GET|POST /api/v1/privacy/consents",
      "DELETE /api/v1/privacy/consents/:purpose",
      "GET|POST /api/v1/privacy/data-requests",
      "GET|POST /api/v1/privacy/exports",
      "GET /api/v1/privacy/exports/:id/download",
    ]),
    controls: Object.freeze(["authentication", "ownership", "reauthentication_for_sensitive_changes"]),
  }),
  orders: Object.freeze({
    description: "Tra cứu, tạo và cập nhật đơn hàng",
    endpoints: Object.freeze([
      "GET /api/v1/orders",
      "GET /api/v1/orders/:id",
      "GET /api/v1/orders/:id/status",
      "PATCH /api/v1/orders/:id",
      "GET /api/v1/admin/orders",
      "PATCH /api/v1/admin/orders/:id",
    ]),
    controls: Object.freeze(["authentication", "ownership_or_access_code", "rbac:read:orders|write:orders"]),
  }),
  addresses: Object.freeze({
    description: "Địa chỉ giao hàng và số điện thoại cá nhân",
    endpoints: Object.freeze([
      "PATCH /api/v1/auth/customer-info",
      "GET /api/v1/orders/:id",
      "GET /api/v1/admin/orders",
    ]),
    controls: Object.freeze(["authentication", "ownership", "no_pii_disclosure_in_public_order"]),
  }),
  pricing_coupons: Object.freeze({
    description: "Tính giá đơn hàng, ưu đãi sinh viên và quản trị mã giảm giá",
    endpoints: Object.freeze([
      "POST /api/v1/orders/quote",
      "POST /api/v1/orders",
      "GET|POST /api/v1/admin/coupons",
      "PUT|PATCH /api/v1/admin/coupons/:code",
      "PATCH /api/v1/admin/users/:id",
    ]),
    controls: Object.freeze(["server_side_pricing", "rbac:read:coupons|write:coupons|write:users"]),
  }),
  inventory: Object.freeze({
    description: "Quản trị danh mục sách, tồn kho, tác giả, nhà xuất bản và ảnh bìa",
    endpoints: Object.freeze([
      "GET|POST /api/v1/admin/books",
      "PUT|PATCH|DELETE /api/v1/admin/books/:id",
      "GET|POST /api/v1/admin/categories",
      "PUT|PATCH|DELETE /api/v1/admin/categories/:slug",
      "GET|POST /api/v1/admin/authors",
      "PUT|PATCH|DELETE /api/v1/admin/authors/:slug",
      "GET|POST /api/v1/admin/publishers",
      "PUT|PATCH|DELETE /api/v1/admin/publishers/:slug",
      "POST /api/v1/admin/uploads/book-cover",
    ]),
    controls: Object.freeze(["authentication", "rbac:read:books|write:books", "stock_reservation_check"]),
  }),
  payments: Object.freeze({
    description: "Xác nhận thanh toán, hoàn tiền và webhook thanh toán",
    endpoints: Object.freeze([
      "POST /api/v1/payments/webhook",
      "POST /api/v1/payments/sepay-webhook",
      "PATCH /api/v1/admin/orders/:id",
    ]),
    controls: Object.freeze(["hmac_sha256_signature", "sepay_apikey", "rbac:write:orders"]),
  }),
  administration: Object.freeze({
    description: "Thống kê, giám sát, nhân sự, khách hàng CRM, DSAR quản trị và audit log",
    endpoints: Object.freeze([
      "GET /api/v1/admin/stats",
      "GET /api/v1/admin/monitoring",
      "GET|POST /api/v1/admin/staff",
      "PATCH /api/v1/admin/staff/:id",
      "GET /api/v1/admin/users",
      "GET /api/v1/admin/audit",
      "GET|POST /api/v1/customers",
      "GET|PUT|PATCH|DELETE /api/v1/customers/:id",
      "GET /api/v1/admin/privacy/data-requests",
      "PATCH /api/v1/admin/privacy/data-requests/:id",
    ]),
    controls: Object.freeze(["authentication", "rbac_least_privilege", "immutable_audit_log"]),
  }),
});

const PERMISSION_MATRIX = Object.freeze({
  dashboard: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze([]) }),
    sales: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
  }),
  orders: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["cancel_instead_of_delete"]) }),
    sales: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["no_payment_status_change", "no_other_user_direct_order_api"]) }),
    support: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze(["own_orders_only"]) }),
    [ROLES.USER]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["own_orders_only", "cancel_only"]) }),
  }),
  services: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    sales: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: true, delete: false, exceptions: Object.freeze(["create_service_request_only"]) }),
  }),
  products: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze([]) }),
    sales: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_catalog_only"]) }),
    support: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_catalog_only"]) }),
    [ROLES.USER]: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_catalog_only"]) }),
  }),
  coupons: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    sales: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_coupon_lookup_only"]) }),
    support: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_coupon_lookup_only"]) }),
    [ROLES.USER]: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["public_coupon_lookup_only"]) }),
  }),
  customers: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["soft_delete"]) }),
    sales: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze([]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
  }),
  customer_interactions: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze([]) }),
    sales: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["create_only_no_update_or_delete"]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
  }),
  profiles_and_addresses: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["student_verification_and_governed_deletion_only"]) }),
    sales: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_account_and_addresses_only"]) }),
    support: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_account_and_addresses_only"]) }),
    [ROLES.USER]: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_account_and_addresses_only", "no_direct_account_delete"]) }),
  }),
  privacy_and_dsar: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["admin_dsar_queue_and_anonymization"]) }),
    sales: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_personal_privacy_only"]) }),
    support: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_personal_privacy_only"]) }),
    [ROLES.USER]: Object.freeze({ read: true, write: true, delete: true, exceptions: Object.freeze(["own_consents_dsar_exports_only"]) }),
  }),
  staff: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: true, delete: false, exceptions: Object.freeze(["sales_and_support_roles_only", "deactivate_revokes_sessions"]) }),
    sales: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
  }),
  audit: Object.freeze({
    [ROLES.ADMIN]: Object.freeze({ read: true, write: false, delete: false, exceptions: Object.freeze(["immutable_append_only"]) }),
    sales: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
    support: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
    [ROLES.USER]: Object.freeze({ read: false, write: false, delete: false, exceptions: Object.freeze([]) }),
  }),
});

function canAccessResource(user, resource, action) {
  if (!user || !Object.hasOwn(PERMISSION_MATRIX, resource)) return false;
  if (!["read", "write", "delete"].includes(action)) return false;
  const role = normalizeRole(user.role);
  return PERMISSION_MATRIX[resource]?.[role]?.[action] === true;
}

function hasPermission(user, permission) {
  const role = normalizeRole(user?.role);
  return ROLE_PERMISSIONS[role]?.includes(permission) === true;
}

function requireOwnershipOrPermission(
  requester,
  { ownerId, permission, message = "Bạn không có quyền truy cập tài nguyên này." } = {},
  RequestErrorClass,
) {
  if (!requester) {
    throw new RequestErrorClass(401, "Chưa đăng nhập.");
  }
  if (permission && hasPermission(requester, permission)) {
    return requester;
  }
  if (ownerId && requester.userId === ownerId) {
    return requester;
  }
  throw new RequestErrorClass(403, message);
}

module.exports = {
  CUSTOMER_ROLE_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_PERMISSIONS,
  SENSITIVE_OPERATIONS_CATALOG,
  authenticate,
  canAccessResource,
  hasPermission,
  requireCustomerPermission,
  requireOwnershipOrPermission,
  requireRole,
};
