"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { CUSTOMER_ROLE_PERMISSIONS, ROLE_PERMISSIONS } = require("../backend/authorization");
const { ENDPOINT_BODY_LIMITS, MAX_URL_LENGTH, UPLOAD_POLICY } = require("../backend/request-limits");
const { getAdminPermission } = require("../backend/router");

const OPENAPI_PATH = path.join(__dirname, "..", "docs", "openapi.json");
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function loadOpenApiSpec() {
  const raw = fs.readFileSync(OPENAPI_PATH, "utf8");
  return { raw, spec: JSON.parse(raw) };
}

function resolvePointer(root, pointer) {
  assert.ok(pointer.startsWith("#/"), `Unsupported external or invalid $ref: ${pointer}`);
  const parts = pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function collectRefs(node, refs = []) {
  if (!node || typeof node !== "object") return refs;
  if (typeof node.$ref === "string") refs.push(node.$ref);
  for (const value of Object.values(node)) {
    collectRefs(value, refs);
  }
  return refs;
}

function rolesWithPermission(permission) {
  if (permission.startsWith("customer:")) {
    const customerPerm = permission.slice("customer:".length);
    return Object.entries(CUSTOMER_ROLE_PERMISSIONS)
      .filter(([, perms]) => perms.includes(customerPerm))
      .map(([role]) => role)
      .sort();
  }
  return Object.entries(ROLE_PERMISSIONS)
    .filter(([, perms]) => perms.includes(permission))
    .map(([role]) => role)
    .sort();
}

test("OpenAPI 3.1.0 specification is structurally valid with zero broken $refs or undeclared tags", () => {
  const { spec } = loadOpenApiSpec();
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "BookNest API");
  assert.match(spec.info.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(spec.servers) && spec.servers.length >= 1);
  assert.ok(spec.components?.securitySchemes?.bearerAuth);
  assert.ok(spec.components?.securitySchemes?.firebaseIdToken);
  assert.ok(spec.components?.securitySchemes?.webhookHmacSignature);
  assert.ok(spec.components?.securitySchemes?.sepayApiKey);
  assert.ok(spec.components?.securitySchemes?.orderAccessCode);
  assert.ok(spec.components?.securitySchemes?.exportDownloadToken);

  // Every $ref resolves cleanly
  const refs = collectRefs(spec);
  assert.ok(refs.length > 50, "Expected reusable component references");
  for (const ref of refs) {
    assert.notEqual(resolvePointer(spec, ref), undefined, `Broken $ref: ${ref}`);
  }

  // Every operation tag is declared in top-level tags
  const declaredTags = new Set((spec.tags || []).map((tag) => tag.name));
  const declaredSchemes = new Set(Object.keys(spec.components.securitySchemes));

  for (const [routePath, pathItemRaw] of Object.entries(spec.paths)) {
    const pathItem = pathItemRaw.$ref ? resolvePointer(spec, pathItemRaw.$ref) : pathItemRaw;
    assert.ok(pathItem, `Invalid path item for ${routePath}`);
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      assert.ok(typeof op.summary === "string" && op.summary.length > 0, `Missing summary on ${method.toUpperCase()} ${routePath}`);
      assert.ok(op.responses && Object.keys(op.responses).length > 0, `Missing responses on ${method.toUpperCase()} ${routePath}`);
      for (const tag of op.tags || []) {
        assert.ok(declaredTags.has(tag), `Undeclared tag "${tag}" on ${method.toUpperCase()} ${routePath}`);
      }
      for (const secReq of op.security || []) {
        for (const schemeName of Object.keys(secReq)) {
          assert.ok(declaredSchemes.has(schemeName), `Undeclared security scheme "${schemeName}" on ${method.toUpperCase()} ${routePath}`);
        }
      }
      // Every {param} in path must be defined in pathItem.parameters or op.parameters
      const pathParams = [...routePath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const declaredParams = new Set(
        [...(pathItem.parameters || []), ...(op.parameters || [])]
          .map((p) => (p.$ref ? resolvePointer(spec, p.$ref) : p))
          .filter((p) => p && p.in === "path")
          .map((p) => p.name),
      );
      for (const paramName of pathParams) {
        assert.ok(declaredParams.has(paramName), `Missing path parameter "${paramName}" on ${method.toUpperCase()} ${routePath}`);
      }
    }
  }
});

test("OpenAPI covers all implemented public, auth, store, privacy, customer, and admin endpoints", () => {
  const { spec } = loadOpenApiSpec();
  const requiredEndpoints = [
    ["/health", "get"],
    ["/ready", "get"],
    ["/api/books", "get"],
    ["/api/categories", "get"],
    ["/api/authors", "get"],
    ["/api/publishers", "get"],
    ["/api/coupons/{code}", "get"],
    ["/api/uploads/book-covers/{filename}", "get"],
    ["/api/policies/privacy", "get"],
    ["/api/policies/terms", "get"],
    ["/api/policies/shipping", "get"],
    ["/api/policies/return", "get"],
    ["/api/policies/refund", "get"],
    ["/api/payments/config", "get"],
    ["/api/payments/webhook", "post"],
    ["/api/payments/sepay-webhook", "post"],
    ["/api/orders/quote", "post"],
    ["/api/orders", "get"],
    ["/api/orders", "post"],
    ["/api/orders/{id}", "get"],
    ["/api/orders/{id}", "patch"],
    ["/api/orders/{id}/status", "get"],
    ["/api/services", "post"],
    ["/api/auth/register", "post"],
    ["/api/auth/login", "post"],
    ["/api/auth/logout", "post"],
    ["/api/auth/me", "get"],
    ["/api/auth/customer-info", "patch"],
    ["/api/auth/password-reset", "post"],
    ["/api/auth/password-reset/confirm", "post"],
    ["/api/auth/social", "post"],
    ["/api/auth/social/link", "post"],
    ["/api/auth/social/unlink", "post"],
    ["/api/privacy/consents", "get"],
    ["/api/privacy/consents", "post"],
    ["/api/privacy/consents/{purpose}", "delete"],
    ["/api/privacy/data-requests", "get"],
    ["/api/privacy/data-requests", "post"],
    ["/api/privacy/exports", "get"],
    ["/api/privacy/exports", "post"],
    ["/api/privacy/exports/{id}/download", "get"],
    ["/api/customers", "get"],
    ["/api/customers", "post"],
    ["/api/customers/{id}", "get"],
    ["/api/customers/{id}", "put"],
    ["/api/customers/{id}", "patch"],
    ["/api/customers/{id}", "delete"],
    ["/api/customers/{id}/interactions", "get"],
    ["/api/customers/{id}/interactions", "post"],
    ["/api/customers/{id}/interactions/{interactionId}", "patch"],
    ["/api/customers/{id}/interactions/{interactionId}", "put"],
    ["/api/customers/{id}/interactions/{interactionId}", "delete"],
    ["/api/admin/stats", "get"],
    ["/api/admin/monitoring", "get"],
    ["/api/admin/audit", "get"],
    ["/api/admin/uploads/book-cover", "post"],
    ["/api/admin/orders", "get"],
    ["/api/admin/orders/{id}", "patch"],
    ["/api/admin/orders/{id}", "put"],
    ["/api/admin/services", "get"],
    ["/api/admin/services/{id}", "patch"],
    ["/api/admin/services/{id}", "put"],
    ["/api/admin/books", "get"],
    ["/api/admin/books", "post"],
    ["/api/admin/books/{id}", "put"],
    ["/api/admin/books/{id}", "patch"],
    ["/api/admin/books/{id}", "delete"],
    ["/api/admin/categories", "get"],
    ["/api/admin/categories", "post"],
    ["/api/admin/categories/{slug}", "put"],
    ["/api/admin/categories/{slug}", "patch"],
    ["/api/admin/categories/{slug}", "delete"],
    ["/api/admin/authors", "get"],
    ["/api/admin/authors", "post"],
    ["/api/admin/authors/{slug}", "put"],
    ["/api/admin/authors/{slug}", "patch"],
    ["/api/admin/authors/{slug}", "delete"],
    ["/api/admin/publishers", "get"],
    ["/api/admin/publishers", "post"],
    ["/api/admin/publishers/{slug}", "put"],
    ["/api/admin/publishers/{slug}", "patch"],
    ["/api/admin/publishers/{slug}", "delete"],
    ["/api/admin/coupons", "get"],
    ["/api/admin/coupons", "post"],
    ["/api/admin/coupons/{code}", "put"],
    ["/api/admin/coupons/{code}", "patch"],
    ["/api/admin/users", "get"],
    ["/api/admin/users/{id}", "patch"],
    ["/api/admin/staff", "get"],
    ["/api/admin/staff", "post"],
    ["/api/admin/staff/{id}", "patch"],
    ["/api/admin/privacy/data-requests", "get"],
    ["/api/admin/privacy/data-requests/{id}", "patch"],
  ];

  for (const [routePath, method] of requiredEndpoints) {
    const rawItem = spec.paths[routePath];
    assert.ok(rawItem, `Missing OpenAPI path: ${routePath}`);
    const resolvedItem = rawItem.$ref ? resolvePointer(spec, rawItem.$ref) : rawItem;
    assert.ok(resolvedItem?.[method], `Missing OpenAPI operation: ${method.toUpperCase()} ${routePath}`);
  }
});

test("OpenAPI permissions, roles, request limits, and error catalog match live implementation", () => {
  const { spec } = loadOpenApiSpec();

  // Verify request limits metadata matches backend/request-limits.js
  assert.equal(spec["x-request-body-limits"].maxUrlLength, MAX_URL_LENGTH);
  assert.deepEqual(spec["x-request-body-limits"].endpointBodyLimitsBytes, ENDPOINT_BODY_LIMITS);
  assert.equal(spec["x-request-body-limits"].uploadPolicy.maxFileBytes, UPLOAD_POLICY.maxFileBytes);
  assert.deepEqual(spec["x-request-body-limits"].uploadPolicy.allowedMimeTypes, [...UPLOAD_POLICY.allowedMimeTypes]);

  // Verify versioning & standard error catalog
  assert.equal(spec["x-api-versioning"].currentVersion, spec.info.version);
  for (const statusCode of ["400", "401", "403", "404", "405", "409", "410", "413", "414", "415", "428", "429", "500", "503"]) {
    assert.ok(spec["x-error-catalog"][statusCode], `Missing error catalog entry for ${statusCode}`);
  }

  // Cross-check x-required-permission and x-allowed-roles against backend/authorization.js & router.js
  const sampleParamValue = (name) => {
    if (name === "id" || name === "interactionId") return "00000000-0000-4000-8000-000000000001";
    if (name === "code") return "BOOKNEST10";
    if (name === "slug") return "van-hoc";
    return "sample";
  };

  for (const [routePath, rawItem] of Object.entries(spec.paths)) {
    const item = rawItem.$ref ? resolvePointer(spec, rawItem.$ref) : rawItem;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      if (routePath.startsWith("/api/admin/") || routePath.startsWith("/api/customers")) {
        assert.ok(op.security?.some((s) => "bearerAuth" in s), `Expected bearerAuth on ${method.toUpperCase()} ${routePath}`);
        assert.ok(typeof op["x-required-permission"] === "string", `Missing x-required-permission on ${method.toUpperCase()} ${routePath}`);
        const expectedRoles = rolesWithPermission(op["x-required-permission"]);
        assert.deepEqual(
          [...(op["x-allowed-roles"] || [])].sort(),
          expectedRoles,
          `Role mismatch on ${method.toUpperCase()} ${routePath}`,
        );
        // Cross-check router.js admin permission where registered
        if (routePath.startsWith("/api/admin/") && !routePath.startsWith("/api/admin/customers") && !routePath.startsWith("/api/admin/privacy")) {
          const concretePath = routePath.replace(/\{([^}]+)\}/g, (_, name) => sampleParamValue(name));
          const routerPerm = getAdminPermission(concretePath, method.toUpperCase());
          if (routerPerm) {
            assert.equal(op["x-required-permission"], routerPerm, `Router permission mismatch on ${method.toUpperCase()} ${routePath}`);
          }
        }
      }
    }
  }
});

test("OpenAPI examples and descriptions do not contain real secrets or sensitive credentials", () => {
  const { raw } = loadOpenApiSpec();
  const forbiddenPatterns = [
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
    /sk_live_[A-Za-z0-9]+/,
    /ghp_[A-Za-z0-9]{20,}/,
    /AIza[0-9A-Za-z_-]{35}/,
    /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    /Apikey\s+[A-Za-z0-9_-]{16,}/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(raw, pattern, `OpenAPI spec must not contain secret-like pattern: ${pattern}`);
  }
});
