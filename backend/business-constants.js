const ROLES = Object.freeze({
  ADMIN: "admin",
  USER: "user",
});

const SERVICE_TYPES = Object.freeze({
  RENT: "rent",
  SELL: "sell",
  EXCHANGE: "exchange",
});

const CUSTOMER_STATUSES = Object.freeze({
  NEW: "new",
  LEAD: "lead",
  CUSTOMER: "customer",
});

const CUSTOMER_INTERACTION_TYPES = Object.freeze({
  CALL: "call",
  CHAT: "chat",
  EMAIL: "email",
  ORDER: "order",
  REVIEW: "review",
  SUPPORT: "support",
  FEEDBACK: "feedback",
});

const ORDER_STATUSES = Object.freeze({
  RECEIVED: "received",
  PROCESSING: "processing",
  SHIPPING: "shipping",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const PAYMENT_STATUSES = Object.freeze({
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  CANCELLED: "cancelled",
  COD_PENDING: "cod_pending",
  REFUNDED: "refunded",
});

const SERVICE_STATUSES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const PAYMENT_METHODS = Object.freeze({
  COD: "cod",
  TRANSFER: "transfer",
});

const STUDENT_VERIFICATION_STATUSES = Object.freeze({
  PENDING: "pending",
  VERIFIED: "verified",
  REVOKED: "revoked",
});

const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.RECEIVED]: Object.freeze([
    ORDER_STATUSES.PROCESSING,
    ORDER_STATUSES.CANCELLED,
  ]),
  [ORDER_STATUSES.PROCESSING]: Object.freeze([
    ORDER_STATUSES.SHIPPING,
    ORDER_STATUSES.CANCELLED,
  ]),
  [ORDER_STATUSES.SHIPPING]: Object.freeze([
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.CANCELLED,
  ]),
  [ORDER_STATUSES.COMPLETED]: Object.freeze([]),
  [ORDER_STATUSES.CANCELLED]: Object.freeze([]),
});

const ORDER_STATUS_ROLE_TRANSITIONS = Object.freeze({
  [ROLES.ADMIN]: ORDER_STATUS_TRANSITIONS,
  sales: ORDER_STATUS_TRANSITIONS,
  [ROLES.USER]: Object.freeze({
    [ORDER_STATUSES.RECEIVED]: Object.freeze([ORDER_STATUSES.CANCELLED]),
    [ORDER_STATUSES.PROCESSING]: Object.freeze([]),
    [ORDER_STATUSES.SHIPPING]: Object.freeze([]),
    [ORDER_STATUSES.COMPLETED]: Object.freeze([]),
    [ORDER_STATUSES.CANCELLED]: Object.freeze([]),
  }),
});

const values = (constantGroup) => Object.freeze(Object.values(constantGroup));
const roleValues = values(ROLES);
const serviceTypeValues = values(SERVICE_TYPES);
const customerStatusValues = values(CUSTOMER_STATUSES);
const customerInteractionTypeValues = values(CUSTOMER_INTERACTION_TYPES);
const orderStatusValues = values(ORDER_STATUSES);
const paymentStatusValues = values(PAYMENT_STATUSES);
const serviceStatusValues = values(SERVICE_STATUSES);
const paymentMethodValues = values(PAYMENT_METHODS);

function isOrderStatusTransitionAllowed(currentStatus, nextStatus) {
  return (
    currentStatus === nextStatus ||
    ORDER_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) === true
  );
}

function isOrderStatusTransitionAllowedForRole(currentStatus, nextStatus, role) {
  return (
    (role !== ROLES.USER && currentStatus === nextStatus) ||
    ORDER_STATUS_ROLE_TRANSITIONS[role]?.[currentStatus]?.includes(nextStatus) === true
  );
}

module.exports = {
  CUSTOMER_STATUSES,
  CUSTOMER_INTERACTION_TYPES,
  ORDER_STATUS_TRANSITIONS,
  ORDER_STATUS_ROLE_TRANSITIONS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  STUDENT_VERIFICATION_STATUSES,
  customerStatusValues,
  customerInteractionTypeValues,
  isOrderStatusTransitionAllowed,
  isOrderStatusTransitionAllowedForRole,
  orderStatusValues,
  paymentMethodValues,
  paymentStatusValues,
  roleValues,
  serviceStatusValues,
  serviceTypeValues,
};
