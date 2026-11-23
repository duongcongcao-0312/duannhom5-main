"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

const PUBLIC_POLICY_PAGES = [
  "privacy.html",
  "terms.html",
  "shipping.html",
  "returns.html",
  "refund.html",
  "content-rights.html",
  "consumer-tax.html",
  "ecommerce-compliance.html",
];

const PUBLIC_POLICY_APIS = [
  "/api/v1/policies/privacy",
  "/api/v1/policies/terms",
  "/api/v1/policies/shipping",
  "/api/v1/policies/return",
  "/api/v1/policies/refund",
  "/api/v1/policies/retention",
  "/api/v1/policies/consent",
  "/api/v1/policies/content-rights",
  "/api/v1/policies/consumer-tax",
  "/api/v1/policies/ecommerce-compliance",
];

test("BN-12 privacy & legal epic exposes all public policy pages, APIs, and consolidated compliance register", async (t) => {
  const root = path.join(__dirname, "..");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-bn12-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // All 8 public HTML policy pages exist and serve 200 without authentication
  for (const page of PUBLIC_POLICY_PAGES) {
    const res = await fetch(`${baseUrl}/${page}`);
    assert.equal(res.status, 200, `/${page} must return 200`);
  }

  // All 10 public policy APIs serve 200 JSON without authentication
  for (const apiPath of PUBLIC_POLICY_APIS) {
    const res = await fetch(`${baseUrl}${apiPath}`);
    assert.equal(res.status, 200, `${apiPath} must return 200`);
    const body = await res.json();
    assert.equal(typeof body, "object");
  }

  // Consolidated compliance register exists and maps BN-189 through BN-202 with legal disclaimer
  const summary = await fs.readFile(path.join(root, "docs", "privacy-legal-compliance-summary.md"), "utf8");
  for (const marker of ["BN-189", "BN-190", "BN-191", "BN-192", "BN-193", "BN-194", "BN-198", "BN-199", "BN-200", "BN-201", "BN-202"]) {
    assert.ok(summary.includes(marker), `compliance summary must reference ${marker}`);
  }
  assert.match(summary, /không thay thế tư vấn pháp lý/i);
});
