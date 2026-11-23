const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { createDatabasePoolConfig } = require("../backend/postgres-db");
const { redactLogText } = require("../backend/monitoring");
const { assertDatabaseEnvironmentIsolation } = require("../backend/env-isolation");
const {
  assertPostMigrationIntegrity,
  verifyPostMigrationIntegrity,
} = require("../backend/migration-integrity");
require("dotenv").config();

const migrationsDirectory = path.join(__dirname, "..", "data", "migrations");

function computeMigrationChecksum(sql) {
  return crypto.createHash("sha256").update(String(sql), "utf8").digest("hex");
}

async function loadMigrationFiles(directory = migrationsDirectory) {
  const filenames = (await fs.readdir(directory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort((left, right) => {
      const leftVersion = Number(left.slice(0, left.indexOf("_")));
      const rightVersion = Number(right.slice(0, right.indexOf("_")));
      return leftVersion - rightVersion || left.localeCompare(right);
    });

  const seenVersions = new Set();
  const migrations = [];
  for (const filename of filenames) {
    const version = filename.slice(0, filename.indexOf("_"));
    const numericVersion = Number(version);
    if (seenVersions.has(numericVersion)) {
      throw new Error(`Phát hiện version migration trùng lặp: ${version} (${filename}).`);
    }
    seenVersions.add(numericVersion);
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    migrations.push({
      version,
      numericVersion,
      filename,
      sql,
      isNoop: sql.trim().length === 0,
      checksum: computeMigrationChecksum(sql),
    });
  }
  return migrations;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT",
  );
}

async function planMigrations(client, directory = migrationsDirectory) {
  const migrations = await loadMigrationFiles(directory);
  await ensureMigrationsTable(client);
  const existingResult = await client.query(
    "SELECT version, filename, checksum FROM schema_migrations ORDER BY version",
  );
  const existingByVersion = new Map(
    (existingResult.rows || []).map((row) => [String(row.version), row]),
  );
  const applied = [];
  const pending = [];
  const checksumMismatches = [];

  for (const migration of migrations) {
    const existing = existingByVersion.get(migration.version);
    if (!existing) {
      pending.push({ version: migration.version, filename: migration.filename });
      continue;
    }
    applied.push({ version: migration.version, filename: migration.filename });
    if (existing.checksum && existing.checksum !== migration.checksum) {
      checksumMismatches.push({
        version: migration.version,
        filename: migration.filename,
        expectedChecksum: existing.checksum,
        actualChecksum: migration.checksum,
      });
    }
  }
  return { applied, pending, checksumMismatches };
}

async function runMigrations(client, directory = migrationsDirectory) {
  const migrations = await loadMigrationFiles(directory);
  await client.query("SELECT pg_advisory_lock(hashtext('booknest_schema_migrations'))");
  const appliedNow = [];
  const skipped = [];
  try {
    await ensureMigrationsTable(client);

    for (const migration of migrations) {
      const { version, filename, sql, checksum } = migration;
      await client.query("BEGIN");
      try {
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [version],
        );
        if (applied.rowCount) {
          const checksumResult = await client.query(
            "SELECT checksum FROM schema_migrations WHERE version = $1",
            [version],
          );
          const recordedChecksum = checksumResult?.rows?.[0]?.checksum;
          if (recordedChecksum && recordedChecksum !== checksum) {
            const mismatchError = new Error(
              `Migration ${filename} (version ${version}) đã bị thay đổi sau khi áp dụng (checksum mismatch). Hãy tạo file migration mới (forward-fix) thay vì sửa file cũ.`,
            );
            mismatchError.code = "MIGRATION_CHECKSUM_MISMATCH";
            throw mismatchError;
          }
          await client.query("COMMIT");
          skipped.push(filename);
          continue;
        }

        if (!migration.isNoop) {
          await client.query(sql);
        }
        await client.query(
          "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
          [version, filename, checksum],
        );
        await client.query("COMMIT");
        appliedNow.push(filename);
        console.log(`Applied database migration ${filename}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied: appliedNow, skipped, total: migrations.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('booknest_schema_migrations'))");
  }
}

async function migrate({ dryRun = process.argv.includes("--dry-run") } = {}) {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL là bắt buộc để chạy migration PostgreSQL.");
  }
  assertDatabaseEnvironmentIsolation(process.env);

  const pool = new Pool(createDatabasePoolConfig(connectionString));
  const client = await pool.connect();
  try {
    if (dryRun) {
      const plan = await planMigrations(client);
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "database_migration_plan",
        ...plan,
      }));
      if (plan.checksumMismatches.length > 0) {
        throw new Error("Phát hiện migration đã chạy bị sửa nội dung (checksum mismatch).");
      }
      return plan;
    }
    const summary = await runMigrations(client);
    const integrity = await assertPostMigrationIntegrity(client);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "database_migration_integrity_verified",
      appliedNow: summary.applied.length,
      appliedMigrations: integrity.appliedMigrations.length,
      counts: integrity.counts,
    }));
    console.log("Database migrations completed.");
    return { summary, integrity };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "database_migration_failed",
      message: redactLogText(error.message),
    }));
    process.exitCode = 1;
  });
}

module.exports = {
  assertPostMigrationIntegrity,
  computeMigrationChecksum,
  loadMigrationFiles,
  planMigrations,
  runMigrations,
  verifyPostMigrationIntegrity,
};
