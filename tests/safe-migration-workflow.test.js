"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  computeMigrationChecksum,
  loadMigrationFiles,
  planMigrations,
  runMigrations,
} = require("../scripts/migrate");

test("repository migrations have strictly unique ordered numeric versions and non-empty SQL", async () => {
  const migrations = await loadMigrationFiles();
  assert.ok(migrations.length >= 20, `expected at least 20 migrations, got ${migrations.length}`);
  for (let i = 1; i < migrations.length; i += 1) {
    assert.ok(
      migrations[i].numericVersion > migrations[i - 1].numericVersion,
      `migrations must be strictly increasing: ${migrations[i - 1].filename} -> ${migrations[i].filename}`,
    );
  }
  for (const m of migrations) {
    assert.match(m.checksum, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(m.sql, /\bDROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
  }
});

test("loadMigrationFiles rejects duplicate version numbers and marks empty placeholder migrations as no-op", async (t) => {
  const dupDir = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-mig-dup-"));
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-mig-empty-"));
  t.after(async () => {
    await fs.rm(dupDir, { recursive: true, force: true });
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(dupDir, "001_first.sql"), "SELECT 1;");
  await fs.writeFile(path.join(dupDir, "001_duplicate.sql"), "SELECT 2;");
  await assert.rejects(() => loadMigrationFiles(dupDir), /trùng lặp/i);

  await fs.writeFile(path.join(emptyDir, "001_noop.sql"), "");
  const loaded = await loadMigrationFiles(emptyDir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].isNoop, true);
});

test("safe migration workflow upgrades empty and populated databases without data loss and detects checksum drift", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-mig-safe-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const sql1 = "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);";
  const sql2 = "ALTER TABLE items ADD COLUMN IF NOT EXISTS note TEXT;";
  await fs.writeFile(path.join(dir, "001_init.sql"), sql1);
  await fs.writeFile(path.join(dir, "002_add_note.sql"), sql2);

  // Simulate a stateful database with existing rows
  const applied = new Map();
  const dataRows = [{ id: "existing-row-1" }];
  const client = {
    async query(sql, values = []) {
      const text = String(sql);
      if (text.includes("SELECT version, filename, checksum FROM schema_migrations")) {
        return { rows: [...applied.values()] };
      }
      if (text.includes("SELECT 1 FROM schema_migrations")) {
        return { rowCount: applied.has(values[0]) ? 1 : 0 };
      }
      if (text.includes("SELECT checksum FROM schema_migrations")) {
        const rec = applied.get(values[0]);
        return { rows: rec ? [{ checksum: rec.checksum }] : [] };
      }
      if (text.includes("INSERT INTO schema_migrations")) {
        applied.set(values[0], { version: values[0], filename: values[1], checksum: values[2] });
        return { rowCount: 1 };
      }
      if (text === sql2) {
        // Non-destructive upgrade preserves existing rows
        for (const row of dataRows) row.note = row.note ?? "";
      }
      return { rowCount: 0, rows: [] };
    },
  };

  // 1. Dry-run plan on empty DB sees both pending
  const emptyPlan = await planMigrations(client, dir);
  assert.equal(emptyPlan.applied.length, 0);
  assert.equal(emptyPlan.pending.length, 2);
  assert.equal(emptyPlan.checksumMismatches.length, 0);

  // 2. Apply migrations on empty DB
  const firstRun = await runMigrations(client, dir);
  assert.deepEqual(firstRun.applied, ["001_init.sql", "002_add_note.sql"]);
  assert.deepEqual(firstRun.skipped, []);
  assert.equal(dataRows.length, 1);
  assert.equal(dataRows[0].id, "existing-row-1");
  assert.equal(dataRows[0].note, "");

  // 3. Re-running on populated DB is idempotent (skips all)
  const secondRun = await runMigrations(client, dir);
  assert.deepEqual(secondRun.applied, []);
  assert.deepEqual(secondRun.skipped, ["001_init.sql", "002_add_note.sql"]);

  // 4. Adding a new forward migration upgrades populated DB incrementally
  await fs.writeFile(path.join(dir, "003_add_tag.sql"), "ALTER TABLE items ADD COLUMN IF NOT EXISTS tag TEXT;");
  const populatedPlan = await planMigrations(client, dir);
  assert.equal(populatedPlan.applied.length, 2);
  assert.deepEqual(populatedPlan.pending.map((p) => p.version), ["003"]);
  const thirdRun = await runMigrations(client, dir);
  assert.deepEqual(thirdRun.applied, ["003_add_tag.sql"]);
  assert.equal(dataRows.length, 1);

  // 5. Editing an already-applied historical migration triggers MIGRATION_CHECKSUM_MISMATCH
  await fs.writeFile(path.join(dir, "001_init.sql"), `${sql1}\n-- tampered`);
  const driftPlan = await planMigrations(client, dir);
  assert.equal(driftPlan.checksumMismatches.length, 1);
  assert.equal(driftPlan.checksumMismatches[0].expectedChecksum, computeMigrationChecksum(sql1));
  await assert.rejects(
    () => runMigrations(client, dir),
    (err) => err.code === "MIGRATION_CHECKSUM_MISMATCH",
  );
});

test("migration workflow runbook documents ordering, checksums, rollback/forward-fix, and integrity checks", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "database-migrations.md"), "utf8");
  assert.match(doc, /schema_migrations/);
  assert.match(doc, /checksum/i);
  assert.match(doc, /Forward-Fix/i);
  assert.match(doc, /--dry-run/);
  assert.match(doc, /ROLLBACK/);
});
