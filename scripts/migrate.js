const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

const migrationsDirectory = path.join(__dirname, "..", "data", "migrations");

async function runMigrations(client, directory = migrationsDirectory) {
  await client.query("SELECT pg_advisory_lock(hashtext('booknest_schema_migrations'))");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const filenames = (await fs.readdir(directory))
      .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
      .sort((left, right) => {
        const leftVersion = Number(left.slice(0, left.indexOf("_")));
        const rightVersion = Number(right.slice(0, right.indexOf("_")));
        return leftVersion - rightVersion || left.localeCompare(right);
      });

    for (const filename of filenames) {
      const version = filename.slice(0, filename.indexOf("_"));
      await client.query("BEGIN");
      try {
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [version],
        );
        if (applied.rowCount) {
          await client.query("COMMIT");
          continue;
        }

        const sql = await fs.readFile(path.join(directory, filename), "utf8");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)",
          [version, filename],
        );
        await client.query("COMMIT");
        console.log(`Applied database migration ${filename}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('booknest_schema_migrations'))");
  }
}

async function migrate() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL là bắt buộc để chạy migration PostgreSQL.");
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  const client = await pool.connect();
  try {
    await runMigrations(client);
    console.log("Database migrations completed.");
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error("Customer CRM migration failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
