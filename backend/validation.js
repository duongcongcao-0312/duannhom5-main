"use strict";

const {
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  STUDENT_VERIFICATION_STATUSES,
} = require("./business-constants");

const FORBIDDEN_OBJECT_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

const SENSITIVE_VALIDATION_FIELDS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "idToken",
  "accessCode",
  "secret",
  "apiKey",
  "authorization",
]);

class ValidationError extends Error {
  constructor(message = "Dữ liệu yêu cầu không hợp lệ.", details = []) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.errorCode = "VALIDATION_ERROR";
    this.details = Array.isArray(details)
      ? details.map((item) => ({
        field: String(item.field || "$root"),
        reason: String(item.reason || "invalid"),
      }))
      : [];
  }
}

const VALIDATION_POLICY = Object.freeze({
  rejectUnknownFields: true,
  rejectPrototypePollutionKeys: true,
  rejectNonFiniteNumbers: true,
  errorCode: "VALIDATION_ERROR",
  redactSensitiveFieldValues: true,
  sensitiveFields: Object.freeze([...SENSITIVE_VALIDATION_FIELDS]),
});

const PAYLOAD_SCHEMAS = Object.freeze({
  passwordReset: {
    allowed: ["email"],
    required: ["email"],
    types: { email: "string" },
    fields: {
      email: { minLength: 3, maxLength: 254 },
    },
  },
  passwordResetConfirm: {
    allowed: ["token", "password"],
    required: ["token", "password"],
    types: { token: "string", password: "string" },
    preserveStrings: ["password"],
    fields: {
      token: { minLength: 1, maxLength: 128 },
      password: { minLength: 1, maxLength: 128 },
    },
  },
  register: {
    allowed: ["name", "email", "password", "studentType", "studentId"],
    required: ["name", "email", "password"],
    types: {
      name: "string",
      email: "string",
      password: "string",
      studentType: "string",
      studentId: "string",
    },
    preserveStrings: ["password"],
    fields: {
      name: { minLength: 1, maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      password: { minLength: 1, maxLength: 128 },
      studentType: { maxLength: 40 },
      studentId: { maxLength: 64 },
    },
  },
  login: {
    allowed: ["email", "password"],
    required: ["email", "password"],
    types: { email: "string", password: "string" },
    preserveStrings: ["password"],
    fields: {
      email: { minLength: 1, maxLength: 254 },
      password: { minLength: 1, maxLength: 256 },
    },
  },
  staff: {
    allowed: ["name", "email", "password", "role"],
    required: ["name", "email", "password", "role"],
    types: { name: "string", email: "string", password: "string", role: "string" },
    preserveStrings: ["password"],
    fields: {
      name: { minLength: 1, maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      password: { minLength: 1, maxLength: 128 },
      role: { maxLength: 32 },
    },
  },
  staffUpdate: {
    allowed: ["name", "email", "role", "isActive"],
    types: { name: "string", email: "string", role: "string", isActive: "boolean" },
    minProperties: 1,
    fields: {
      name: { minLength: 1, maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      role: { maxLength: 32 },
    },
  },
  socialAuth: {
    allowed: [
      "name",
      "email",
      "provider",
      "providerId",
      "firebaseUid",
      "studentType",
      "studentId",
    ],
    required: ["email"],
    types: {
      name: "string",
      email: "string",
      provider: "string",
      providerId: "string",
      firebaseUid: "string",
      studentType: "string",
      studentId: "string",
    },
    fields: {
      name: { maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      provider: { maxLength: 64 },
      providerId: { maxLength: 128 },
      firebaseUid: { maxLength: 128 },
      studentType: { maxLength: 40 },
      studentId: { maxLength: 64 },
    },
  },
  socialAuthLink: {
    allowed: ["idToken", "password"],
    required: ["idToken", "password"],
    types: { idToken: "string", password: "string" },
    preserveStrings: ["idToken", "password"],
    fields: {
      idToken: { minLength: 1, maxLength: 8192 },
      password: { minLength: 1, maxLength: 128 },
    },
  },
  socialAuthUnlink: {
    allowed: ["provider", "password"],
    required: ["provider", "password"],
    types: { provider: "string", password: "string" },
    preserveStrings: ["password"],
    fields: {
      provider: { minLength: 1, maxLength: 64 },
      password: { minLength: 1, maxLength: 128 },
    },
  },
  customerInfo: {
    allowed: ["customerName", "name", "phone", "address", "currentPassword"],
    types: {
      customerName: "string",
      name: "string",
      phone: "string",
      address: "string",
      currentPassword: "string",
    },
    minProperties: 1,
    preserveStrings: ["currentPassword"],
    fields: {
      customerName: { maxLength: 120 },
      name: { maxLength: 120 },
      phone: { maxLength: 32 },
      address: { maxLength: 300 },
      currentPassword: { maxLength: 128 },
    },
  },
  customerInteraction: {
    allowed: ["type", "note"],
    required: ["type", "note"],
    types: { type: "string", note: "string" },
    preserveStrings: ["note"],
    fields: {
      type: { minLength: 1, maxLength: 32 },
      note: { minLength: 1, maxLength: 2000 },
    },
  },
  customerInteractionUpdate: {
    allowed: ["type", "note"],
    types: { type: "string", note: "string" },
    minProperties: 1,
    preserveStrings: ["note"],
    fields: {
      type: { minLength: 1, maxLength: 32 },
      note: { minLength: 1, maxLength: 2000 },
    },
  },
  customer: {
    allowed: ["name", "email", "phone"],
    required: ["name", "email", "phone"],
    types: { name: "string", email: "string", phone: "string" },
    fields: {
      name: { minLength: 1, maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      phone: { minLength: 6, maxLength: 32 },
    },
  },
  customerUpdate: {
    allowed: ["name", "email", "phone", "status"],
    types: {
      name: "string",
      email: "string",
      phone: "string",
      status: "string",
    },
    minProperties: 1,
    fields: {
      name: { minLength: 1, maxLength: 120 },
      email: { minLength: 3, maxLength: 254 },
      phone: { minLength: 6, maxLength: 32 },
      status: { enum: Object.values(CUSTOMER_STATUSES) },
    },
  },
  order: {
    allowed: [
      "customerName",
      "address",
      "addressId",
      "phone",
      "paymentMethod",
      "accessCode",
      "discountRate",
      "couponCode",
      "subtotal",
      "discount",
      "total",
      "items",
    ],
    required: [
      "customerName",
      "address",
      "phone",
      "paymentMethod",
      "items",
    ],
    types: {
      customerName: "string",
      address: "string",
      addressId: "string",
      phone: "string",
      paymentMethod: "string",
      accessCode: "string",
      discountRate: "number",
      couponCode: "string",
      subtotal: "number",
      discount: "number",
      total: "number",
      items: "array",
    },
    fields: {
      customerName: { maxLength: 200 },
      address: { maxLength: 500 },
      addressId: { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
      phone: { maxLength: 32 },
      paymentMethod: { maxLength: 32 },
      accessCode: { maxLength: 128 },
      couponCode: { maxLength: 128 },
      items: { minItems: 1, maxItems: 50 },
    },
  },
  address: {
    allowed: [
      "recipientName",
      "phone",
      "addressLine",
      "ward",
      "district",
      "city",
      "label",
      "isDefault",
    ],
    required: ["recipientName", "phone", "addressLine"],
    types: {
      recipientName: "string",
      phone: "string",
      addressLine: "string",
      ward: "string",
      district: "string",
      city: "string",
      label: "string",
      isDefault: "boolean",
    },
    fields: {
      recipientName: { minLength: 2, maxLength: 120 },
      phone: { minLength: 8, maxLength: 20 },
      addressLine: { minLength: 5, maxLength: 300 },
      ward: { maxLength: 100 },
      district: { maxLength: 100 },
      city: { maxLength: 100 },
      label: { maxLength: 60 },
    },
  },
  addressUpdate: {
    allowed: [
      "recipientName",
      "phone",
      "addressLine",
      "ward",
      "district",
      "city",
      "label",
      "isDefault",
    ],
    types: {
      recipientName: "string",
      phone: "string",
      addressLine: "string",
      ward: "string",
      district: "string",
      city: "string",
      label: "string",
      isDefault: "boolean",
    },
    minProperties: 1,
    fields: {
      recipientName: { minLength: 2, maxLength: 120 },
      phone: { minLength: 8, maxLength: 20 },
      addressLine: { minLength: 5, maxLength: 300 },
      ward: { maxLength: 100 },
      district: { maxLength: 100 },
      city: { maxLength: 100 },
      label: { maxLength: 60 },
    },
  },
  orderQuote: {
    allowed: ["discountRate", "couponCode", "items"],
    required: ["items"],
    types: {
      discountRate: "number",
      couponCode: "string",
      items: "array",
    },
    fields: {
      couponCode: { maxLength: 128 },
      items: { minItems: 1, maxItems: 50 },
    },
  },
  coupon: {
    allowed: [
      "code",
      "label",
      "rate",
      "minSubtotal",
      "maxUses",
      "startsAt",
      "expiresAt",
      "enabled",
    ],
    required: [
      "code",
      "label",
      "rate",
      "minSubtotal",
      "maxUses",
      "startsAt",
      "expiresAt",
      "enabled",
    ],
    types: {
      code: "string",
      label: "string",
      rate: "number",
      minSubtotal: "number",
      maxUses: "number",
      startsAt: "string",
      expiresAt: "string",
      enabled: "boolean",
    },
    fields: {
      code: { minLength: 3, maxLength: 32 },
      label: { minLength: 1, maxLength: 160 },
      rate: { min: 0, max: 0.3 },
      minSubtotal: { min: 0 },
      maxUses: { min: 0 },
      startsAt: { maxLength: 64 },
      expiresAt: { maxLength: 64 },
    },
  },
  couponUpdate: {
    allowed: [
      "label",
      "rate",
      "minSubtotal",
      "maxUses",
      "startsAt",
      "expiresAt",
      "enabled",
    ],
    required: [
      "label",
      "rate",
      "minSubtotal",
      "maxUses",
      "startsAt",
      "expiresAt",
      "enabled",
    ],
    types: {
      label: "string",
      rate: "number",
      minSubtotal: "number",
      maxUses: "number",
      startsAt: "string",
      expiresAt: "string",
      enabled: "boolean",
    },
    fields: {
      label: { minLength: 1, maxLength: 160 },
      rate: { min: 0, max: 0.3 },
      minSubtotal: { min: 0 },
      maxUses: { min: 0 },
      startsAt: { maxLength: 64 },
      expiresAt: { maxLength: 64 },
    },
  },
  couponToggle: {
    allowed: ["enabled"],
    required: ["enabled"],
    types: { enabled: "boolean" },
  },
  orderUpdate: {
    allowed: ["status", "paymentStatus", "items"],
    types: { status: "string", paymentStatus: "string", items: "array" },
    minProperties: 1,
    fields: {
      status: { enum: Object.values(ORDER_STATUSES) },
      paymentStatus: { enum: Object.values(PAYMENT_STATUSES) },
      items: { minItems: 1, maxItems: 50 },
    },
  },
  orderStatusUpdate: {
    allowed: ["status", "paymentStatus"],
    types: { status: "string", paymentStatus: "string" },
    minProperties: 1,
    fields: {
      status: { enum: Object.values(ORDER_STATUSES) },
      paymentStatus: { enum: Object.values(PAYMENT_STATUSES) },
    },
  },
  service: {
    allowed: ["bookTitle", "name", "phone", "service", "condition", "note"],
    required: ["bookTitle", "name", "phone", "service"],
    types: {
      bookTitle: "string",
      name: "string",
      phone: "string",
      service: "string",
      condition: "string",
      note: "string",
    },
    fields: {
      bookTitle: { minLength: 1, maxLength: 200 },
      name: { minLength: 1, maxLength: 120 },
      phone: { minLength: 6, maxLength: 32 },
      service: { enum: Object.values(SERVICE_TYPES) },
      condition: { maxLength: 120 },
      note: { maxLength: 1000 },
    },
  },
  serviceStatus: {
    allowed: ["status"],
    required: ["status"],
    types: { status: "string" },
    fields: {
      status: { enum: Object.values(SERVICE_STATUSES) },
    },
  },
  book: {
    allowed: [
      "title",
      "author",
      "authorIds",
      "authors",
      "publisher",
      "publisherId",
      "category",
      "price",
      "stock",
      "cover",
      "images",
      "isbn",
      "description",
      "isActive",
      "discontinued",
      "status",
    ],
    required: ["title", "price"],
    types: {
      title: "string",
      author: "string",
      authorIds: "array",
      authors: "array",
      publisher: "string",
      publisherId: "string",
      category: "string",
      price: "number",
      stock: "number",
      cover: "string",
      images: "array",
      isbn: "string",
      description: "string",
      isActive: "boolean",
      discontinued: "boolean",
      status: "string",
    },
    fields: {
      title: { minLength: 1, maxLength: 240 },
      author: { maxLength: 200 },
      authorIds: { maxItems: 20 },
      authors: { maxItems: 20 },
      publisher: { maxLength: 200 },
      publisherId: { maxLength: 120 },
      category: { maxLength: 120 },
      price: { min: 0 },
      stock: { min: 0 },
      cover: { maxLength: 500 },
      images: { maxItems: 8 },
      isbn: { maxLength: 20 },
      description: { maxLength: 4000 },
      status: { maxLength: 32 },
    },
  },
  bookUpdate: {
    allowed: [
      "title",
      "author",
      "authorIds",
      "authors",
      "publisher",
      "publisherId",
      "category",
      "price",
      "stock",
      "cover",
      "images",
      "isbn",
      "description",
      "isActive",
      "discontinued",
      "status",
    ],
    types: {
      title: "string",
      author: "string",
      authorIds: "array",
      authors: "array",
      publisher: "string",
      publisherId: "string",
      category: "string",
      price: "number",
      stock: "number",
      cover: "string",
      images: "array",
      isbn: "string",
      description: "string",
      isActive: "boolean",
      discontinued: "boolean",
      status: "string",
    },
    minProperties: 1,
    fields: {
      title: { minLength: 1, maxLength: 240 },
      author: { maxLength: 200 },
      authorIds: { maxItems: 20 },
      authors: { maxItems: 20 },
      publisher: { maxLength: 200 },
      publisherId: { maxLength: 120 },
      category: { maxLength: 120 },
      price: { min: 0 },
      stock: { min: 0 },
      cover: { maxLength: 500 },
      images: { maxItems: 8 },
      isbn: { maxLength: 20 },
      description: { maxLength: 4000 },
      status: { maxLength: 32 },
    },
  },
  review: {
    allowed: ["rating", "content"],
    required: ["rating", "content"],
    types: { rating: "number", content: "string" },
    fields: {
      rating: { min: 1, max: 5 },
      content: { minLength: 1, maxLength: 1000 },
    },
  },
  reviewModeration: {
    allowed: ["status"],
    required: ["status"],
    types: { status: "string" },
    fields: { status: { enum: ["visible", "hidden", "rejected"] } },
  },
  favorite: {
    allowed: ["bookId"],
    required: ["bookId"],
    types: { bookId: "string" },
    fields: { bookId: { minLength: 1, maxLength: 128 } },
  },
  category: {
    allowed: ["id", "slug", "value", "name", "label", "status", "description"],
    types: {
      id: "string",
      slug: "string",
      value: "string",
      name: "string",
      label: "string",
      status: "string",
      description: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      value: { maxLength: 120 },
      name: { maxLength: 120 },
      label: { maxLength: 120 },
      status: { enum: ["active", "inactive"] },
      description: { maxLength: 500 },
    },
  },
  categoryUpdate: {
    allowed: ["id", "slug", "value", "name", "label", "status", "description"],
    types: {
      id: "string",
      slug: "string",
      value: "string",
      name: "string",
      label: "string",
      status: "string",
      description: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      value: { maxLength: 120 },
      name: { maxLength: 120 },
      label: { maxLength: 120 },
      status: { enum: ["active", "inactive"] },
      description: { maxLength: 500 },
    },
  },
  author: {
    allowed: ["id", "slug", "name", "displayName", "status", "bio"],
    types: {
      id: "string",
      slug: "string",
      name: "string",
      displayName: "string",
      status: "string",
      bio: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      name: { maxLength: 200 },
      displayName: { maxLength: 200 },
      status: { enum: ["active", "inactive"] },
      bio: { maxLength: 1000 },
    },
  },
  authorUpdate: {
    allowed: ["id", "slug", "name", "displayName", "status", "bio"],
    types: {
      id: "string",
      slug: "string",
      name: "string",
      displayName: "string",
      status: "string",
      bio: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      name: { maxLength: 200 },
      displayName: { maxLength: 200 },
      status: { enum: ["active", "inactive"] },
      bio: { maxLength: 1000 },
    },
  },
  publisher: {
    allowed: ["id", "slug", "name", "displayName", "status", "address", "website"],
    types: {
      id: "string",
      slug: "string",
      name: "string",
      displayName: "string",
      status: "string",
      address: "string",
      website: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      name: { maxLength: 200 },
      displayName: { maxLength: 200 },
      status: { enum: ["active", "inactive"] },
      address: { maxLength: 300 },
      website: { maxLength: 500 },
    },
  },
  publisherUpdate: {
    allowed: ["id", "slug", "name", "displayName", "status", "address", "website"],
    types: {
      id: "string",
      slug: "string",
      name: "string",
      displayName: "string",
      status: "string",
      address: "string",
      website: "string",
    },
    minProperties: 1,
    fields: {
      id: { maxLength: 120 },
      slug: { maxLength: 120 },
      name: { maxLength: 200 },
      displayName: { maxLength: 200 },
      status: { enum: ["active", "inactive"] },
      address: { maxLength: 300 },
      website: { maxLength: 500 },
    },
  },
  studentVerificationUpdate: {
    allowed: ["studentVerificationStatus"],
    required: ["studentVerificationStatus"],
    types: { studentVerificationStatus: "string" },
    fields: {
      studentVerificationStatus: { enum: Object.values(STUDENT_VERIFICATION_STATUSES) },
    },
  },
});

function hasForbiddenKeys(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeys(item));
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_OBJECT_KEYS.includes(key)) return true;
    if (hasForbiddenKeys(value[key])) return true;
  }
  return false;
}

function checkFieldType(value, expectedType) {
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (expectedType === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return typeof value === expectedType;
}

function validateJsonPayload(
  payload,
  schema,
  { message = "Dữ liệu yêu cầu không hợp lệ.", sanitizePayload } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError(message, [{ field: "$root", reason: "expected_object" }]);
  }

  const rawPrototype = Object.getPrototypeOf(payload);
  if (rawPrototype !== Object.prototype && rawPrototype !== null) {
    throw new ValidationError(message, [{ field: "$root", reason: "invalid_prototype" }]);
  }

  if (hasForbiddenKeys(payload)) {
    throw new ValidationError(message, [{ field: "$root", reason: "forbidden_key" }]);
  }

  const sanitized = typeof sanitizePayload === "function" ? sanitizePayload(payload) : { ...payload };
  for (const field of schema?.preserveStrings || []) {
    if (typeof payload[field] === "string") {
      sanitized[field] = payload[field];
    }
  }
  const prototype = Object.getPrototypeOf(sanitized);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError(message, [{ field: "$root", reason: "invalid_prototype" }]);
  }

  if (!schema) {
    return sanitized;
  }

  const allowedFields = new Set(schema.allowed || []);
  for (const field of Object.keys(sanitized)) {
    if (!allowedFields.has(field)) {
      throw new ValidationError(message, [{ field, reason: "unexpected_field" }]);
    }
  }

  for (const field of schema.required || []) {
    if (!Object.hasOwn(sanitized, field)) {
      throw new ValidationError(message, [{ field, reason: "required" }]);
    }
  }

  if (
    Number.isInteger(schema.minProperties) &&
    Object.keys(sanitized).length < schema.minProperties
  ) {
    throw new ValidationError(message, [{ field: "$root", reason: "min_properties" }]);
  }

  for (const [field, expectedType] of Object.entries(schema.types || {})) {
    if (!Object.hasOwn(sanitized, field)) continue;
    if (!checkFieldType(sanitized[field], expectedType)) {
      throw new ValidationError(message, [{ field, reason: "invalid_type" }]);
    }
  }

  for (const [field, rules] of Object.entries(schema.fields || {})) {
    if (!Object.hasOwn(sanitized, field)) continue;
    const value = sanitized[field];

    if (typeof value === "string") {
      if (Number.isInteger(rules.minLength) && value.length < rules.minLength) {
        throw new ValidationError(message, [{ field, reason: "min_length" }]);
      }
      if (Number.isInteger(rules.maxLength) && value.length > rules.maxLength) {
        throw new ValidationError(message, [{ field, reason: "max_length" }]);
      }
      if (rules.pattern instanceof RegExp && !rules.pattern.test(value)) {
        throw new ValidationError(message, [{ field, reason: "invalid_format" }]);
      }
    }

    if (typeof value === "number") {
      if (typeof rules.min === "number" && value < rules.min) {
        throw new ValidationError(message, [{ field, reason: "min_value" }]);
      }
      if (typeof rules.max === "number" && value > rules.max) {
        throw new ValidationError(message, [{ field, reason: "max_value" }]);
      }
    }

    if (Array.isArray(value)) {
      if (Number.isInteger(rules.minItems) && value.length < rules.minItems) {
        throw new ValidationError(message, [{ field, reason: "min_items" }]);
      }
      if (Number.isInteger(rules.maxItems) && value.length > rules.maxItems) {
        throw new ValidationError(message, [{ field, reason: "max_items" }]);
      }
    }

    if (Array.isArray(rules.enum) && !rules.enum.includes(value)) {
      throw new ValidationError(message, [{ field, reason: "invalid_enum" }]);
    }
  }

  return sanitized;
}

function validateQueryParams(requestUrl, schema, message = "Tham số truy vấn không hợp lệ.") {
  const values = {};
  for (const [field, value] of requestUrl.searchParams) {
    const definition = schema[field];
    if (!definition) {
      throw new ValidationError(message, [{ field, reason: "unexpected_query_param" }]);
    }
    if (Object.hasOwn(values, field)) {
      throw new ValidationError(message, [{ field, reason: "duplicate_query_param" }]);
    }
    if (value.length > definition.maxLength) {
      throw new ValidationError(message, [{ field, reason: "max_length" }]);
    }

    if (definition.type === "integer") {
      if (!/^\d+$/.test(value)) {
        throw new ValidationError(message, [{ field, reason: "invalid_integer" }]);
      }
      const number = Number(value);
      if (
        !Number.isSafeInteger(number) ||
        number < definition.min ||
        number > definition.max
      ) {
        throw new ValidationError(message, [{ field, reason: "out_of_range" }]);
      }
      values[field] = number;
      continue;
    }
    if (definition.values && !definition.values.includes(value)) {
      throw new ValidationError(message, [{ field, reason: "invalid_enum" }]);
    }
    values[field] = value;
  }
  return values;
}

module.exports = {
  FORBIDDEN_OBJECT_KEYS,
  PAYLOAD_SCHEMAS,
  SENSITIVE_VALIDATION_FIELDS,
  VALIDATION_POLICY,
  ValidationError,
  validateJsonPayload,
  validateQueryParams,
};
