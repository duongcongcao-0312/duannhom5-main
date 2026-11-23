const assert = require("node:assert/strict");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");
const {
  DATA_RETENTION_POLICY,
  evaluateRetentionDisposition,
} = require("../backend/data-retention-policy");
const { runPrivacyConsentRetention } = require("../scripts/prune-privacy-consents");

test("file storage prunes only consent records whose explicit retention period expired", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-privacy-retention-"));
  const consentRecordsPath = path.join(directory, "consents.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(consentRecordsPath, JSON.stringify([
    {
      id: "expired",
      subjectId: "user-1",
      purpose: "marketing",
      createdAt: "2025-01-01T00:00:00.000Z",
      retentionDays: 30,
    },
    {
      id: "no-policy",
      subjectId: "user-1",
      purpose: "service",
      createdAt: "2025-01-01T00:00:00.000Z",
      retentionDays: 0,
    },
    {
      id: "active",
      subjectId: "user-1",
      purpose: "order",
      createdAt: "2026-10-25T00:00:00.000Z",
      retentionDays: 30,
    },
  ]));
  const database = new Database({ consentRecordsPath });

  const pruned = await database.pruneExpiredConsentRecords(
    new Date("2026-11-18T00:00:00.000Z"),
  );

  assert.equal(pruned, 1);
  assert.deepEqual(
    (await database.getConsentRecords("user-1")).map((record) => record.id).sort(),
    ["active", "no-policy"],
  );
});

test("retention runner defaults to dry-run and only prunes when apply is requested", async () => {
  const calls = [];
  const database = {
    async getExpiredConsentRecordCount(asOf) {
      calls.push(["count", asOf]);
      return 2;
    },
    async pruneExpiredConsentRecords(asOf) {
      calls.push(["prune", asOf]);
      return 2;
    },
  };
  const asOf = new Date("2026-11-18T00:00:00.000Z");
  const output = [];

  const preview = await runPrivacyConsentRetention({
    database,
    asOf,
    output: (line) => output.push(line),
  });
  assert.deepEqual(preview, {
    mode: "dry-run",
    asOf: asOf.toISOString(),
    eligible: 2,
    pruned: 0,
  });
  assert.deepEqual(calls, [["count", asOf]]);

  const applied = await runPrivacyConsentRetention({
    database,
    apply: true,
    asOf,
    output: (line) => output.push(line),
  });
  assert.deepEqual(applied, {
    mode: "apply",
    asOf: asOf.toISOString(),
    eligible: 2,
    pruned: 2,
  });
  assert.deepEqual(calls, [
    ["count", asOf],
    ["count", asOf],
    ["prune", asOf],
  ]);
  assert.equal(output.length, 2);
});

test("DATA_RETENTION_POLICY defines all 4 domains, legal hold exceptions, and evaluates retention dispositions accurately", () => {
  assert.deepEqual(DATA_RETENTION_POLICY.domains, ["operational", "transactional", "logs", "backups"]);
  const coveredDomains = new Set(DATA_RETENTION_POLICY.schedule.map((item) => item.domain));
  for (const domain of DATA_RETENTION_POLICY.domains) {
    assert.ok(coveredDomains.has(domain), `Retention schedule must cover domain "${domain}"`);
  }
  assert.ok(DATA_RETENTION_POLICY.legalHoldExceptions.length >= 4);

  // Operational TTL & consent deletion
  assert.equal(evaluateRetentionDisposition("consent_records", { ageDays: 30 }).action, "retain");
  assert.equal(evaluateRetentionDisposition("consent_records", { ageDays: 400 }).action, "delete");
  assert.equal(
    evaluateRetentionDisposition("consent_records", { ageDays: 400, legalHold: true }).action,
    "legal_hold",
  );

  // Transactional anonymization & legal hold override
  assert.equal(evaluateRetentionDisposition("orders_and_payments", { ageDays: 365 }).action, "retain");
  assert.equal(evaluateRetentionDisposition("orders_and_payments", { ageDays: 3650 }).action, "anonymize");
  assert.equal(
    evaluateRetentionDisposition("orders_and_payments", { ageDays: 4000, legalHold: true }).action,
    "legal_hold",
  );

  // Logs & backups
  assert.equal(evaluateRetentionDisposition("admin_audit_logs", { ageDays: 365 }).action, "delete");
  assert.equal(evaluateRetentionDisposition("encrypted_backups", { ageDays: 30 }).action, "delete");

  // Public privacy page & internal retention policy doc are synchronized
  const root = path.join(__dirname, "..");
  const privacyHtml = fsSync.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(privacyHtml, /id="dataRetentionSchedule"/);
  assert.match(privacyHtml, /Legal Hold/);

  const doc = fsSync.readFileSync(path.join(root, "docs", "data-retention-policy.md"), "utf8");
  for (const keyword of ["operational", "transactional", "logs", "backups", "Legal Hold"]) {
    assert.ok(doc.includes(keyword), `docs/data-retention-policy.md must include "${keyword}"`);
  }
});

test("public retention policy API returns DATA_RETENTION_POLICY without authentication", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-retention-api-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    auditLogPath: path.join(directory, "audit.jsonl"),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const endpoint of ["/api/policies/retention", "/api/v1/policies/retention"]) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.policy.version, DATA_RETENTION_POLICY.version);
    assert.deepEqual(body.policy.domains, ["operational", "transactional", "logs", "backups"]);
    assert.equal(body.policy.schedule.length, DATA_RETENTION_POLICY.schedule.length);
  }
});
