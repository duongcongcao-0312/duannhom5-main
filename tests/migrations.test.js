const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runMigrations } = require("../scripts/migrate");

test("database migrations run in numeric order once and record each version", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-migrations-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, "010_later.sql"), "SELECT 'later';"),
    fs.writeFile(path.join(directory, "002_earlier.sql"), "SELECT 'earlier';"),
    fs.writeFile(path.join(directory, "README.md"), "not a migration"),
  ]);

  const applied = new Set();
  const statements = [];
  const client = {
    async query(sql, values = []) {
      statements.push(sql);
      if (sql.includes("SELECT 1 FROM schema_migrations")) {
        return { rowCount: applied.has(values[0]) ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO schema_migrations")) {
        applied.add(values[0]);
      }
      return { rowCount: 0 };
    },
  };

  await runMigrations(client, directory);
  assert.deepEqual(
    statements.filter((sql) => sql.startsWith("SELECT '")),
    ["SELECT 'earlier';", "SELECT 'later';"],
  );
  assert.deepEqual([...applied], ["002", "010"]);

  statements.length = 0;
  await runMigrations(client, directory);
  assert.equal(statements.some((sql) => sql.startsWith("SELECT '")), false);
  assert.equal(statements.filter((sql) => sql === "BEGIN").length, 2);
});

test("database migration failure rolls back the version and releases the migration lock", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-migration-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "001_broken.sql"), "SELECT 'broken';");
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === "SELECT 'broken';") throw new Error("migration failed");
      return { rowCount: 0 };
    },
  };

  await assert.rejects(runMigrations(client, directory), /migration failed/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(statements.some((sql) => sql.includes("pg_advisory_unlock")));
});
