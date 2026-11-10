const assert = require("node:assert/strict");
const test = require("node:test");
const { findRoute, getAdminPermission } = require("../backend/router");

test("route table identifies public and grouped API handlers", () => {
  assert.equal(findRoute("/health", "GET").name, "health");
  assert.equal(findRoute("/api/auth/login", "POST").name, "auth");
  assert.equal(findRoute("/api/orders/123e4567-e89b-12d3-a456-426614174000", "GET").name, "orders");
  assert.equal(findRoute("/unknown", "GET"), null);
});

test("route table preserves admin permission mapping and method restrictions", () => {
  assert.equal(getAdminPermission("/api/admin/books", "GET"), "read:books");
  assert.equal(getAdminPermission("/api/admin/books", "POST"), "write:books");
  assert.equal(getAdminPermission("/api/admin/orders", "GET"), "read:orders");
  assert.equal(getAdminPermission("/api/admin/orders/123e4567-e89b-12d3-a456-426614174000", "PATCH"), "write:orders");
  assert.equal(getAdminPermission("/api/admin/customers", "POST"), "write:customers");
  assert.equal(getAdminPermission("/api/admin/customers/123e4567-e89b-12d3-a456-426614174000", "DELETE"), "delete:customers");
  assert.equal(getAdminPermission("/api/admin/orders", "POST"), null);
});
