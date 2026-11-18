const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Database } = require("../backend/db");
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
