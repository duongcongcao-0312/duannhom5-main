"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PostgresDatabase } = require("../backend/postgres-db");
const { runMigrations } = require("../scripts/migrate");

const migrationsDir = path.join(__dirname, "..", "data", "migrations");

test("migration 014 aligns privacy_data_requests.subject_id with app_users.user_id TEXT and safely upgrades legacy UUID tables", async () => {
  const mig005 = await fs.readFile(path.join(migrationsDir, "005_relational_store.sql"), "utf8");
  const mig014 = await fs.readFile(path.join(migrationsDir, "014_privacy_data_requests.sql"), "utf8");

  assert.match(mig005, /CREATE TABLE IF NOT EXISTS app_users\s*\([\s\S]*?user_id\s+TEXT\s+PRIMARY KEY/i);
  assert.match(mig014, /subject_id\s+TEXT\s+NOT NULL/i);
  assert.doesNotMatch(mig014, /subject_id\s+UUID\b/i);
  assert.match(
    mig014,
    /ALTER COLUMN subject_id TYPE TEXT USING subject_id::text/i,
    "014 must safely convert legacy UUID subject_id columns to TEXT without data loss",
  );
  assert.match(
    mig014,
    /ADD CONSTRAINT privacy_data_requests_subject_fk\s+FOREIGN KEY \(subject_id\) REFERENCES app_users\(user_id\) ON DELETE RESTRICT/i,
  );
});

test("PostgresDatabase queries privacy_data_requests using TEXT subject_id instead of UUID cast", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-mig014-"));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const seenQueries = [];
  const fakePool = {
    async query(sql, params) {
      seenQueries.push({ sql: String(sql), params });
      if (String(sql).includes("INSERT INTO privacy_data_requests")) {
        return {
          rows: [
            {
              request_id: "11111111-1111-4111-8111-111111111111",
              subject_id: params[0],
              request_type: params[1],
              status: "pending",
              channel: params[2],
              verification_method: params[3],
              assigned_to: null,
              escalation_level: "l1_support",
              resolution_code: null,
              due_at: params[4],
              created_by: params[0],
              updated_by: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              resolved_at: null,
            },
          ],
        };
      }
      return {
        rows: [
          {
            request_id: "11111111-1111-4111-8111-111111111111",
            subject_id: params[0],
            request_type: "access",
            status: "pending",
            channel: "web_portal",
            verification_method: "session_token",
            assigned_to: null,
            escalation_level: "l1_support",
            resolution_code: null,
            due_at: new Date(Date.now() + 86400000).toISOString(),
            created_by: params[0],
            updated_by: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolved_at: null,
          },
        ],
      };
    },
  };

  const store = new PostgresDatabase({
    pool: fakePool,
    auditLogPath: path.join(tmpDir, "audit.jsonl"),
  });

  // Non-UUID TEXT user_id (such as legacy or Firebase UID) must work without ::uuid cast errors.
  const created = await store.createPrivacyDataRequest("legacy-user-1", "access");
  assert.equal(created.subjectId, "legacy-user-1");

  const list = await store.getPrivacyDataRequests("legacy-user-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].subjectId, "legacy-user-1");

  for (const entry of seenQueries) {
    assert.doesNotMatch(
      entry.sql,
      /subject_id\s*=\s*\$1::uuid/i,
      "getPrivacyDataRequests must not cast subject_id parameter to ::uuid",
    );
    assert.doesNotMatch(
      entry.sql,
      /VALUES\s*\(\$1::uuid/i,
      "createPrivacyDataRequest must not cast subject_id parameter to ::uuid",
    );
    assert.match(entry.sql, /\$1::text/i);
  }
});

test("migration 014 runs cleanly on both empty and populated migration histories", async () => {
  // 1. Empty database: 001..025 all apply cleanly including 014.
  const emptyApplied = new Map();
  const emptyClient = {
    async query(sql, values = []) {
      const text = String(sql).trim();
      if (text.startsWith("SELECT 1 FROM schema_migrations")) {
        return { rowCount: emptyApplied.has(values[0]) ? 1 : 0, rows: [] };
      }
      if (text.startsWith("SELECT checksum FROM schema_migrations")) {
        const row = emptyApplied.get(values[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ checksum: row.checksum }] : [] };
      }
      if (text.startsWith("INSERT INTO schema_migrations")) {
        emptyApplied.set(values[0], { filename: values[1], checksum: values[2] });
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const emptyResult = await runMigrations(emptyClient, migrationsDir);
  assert.ok(emptyResult.applied.includes("014_privacy_data_requests.sql"));

  // 2. Populated database upgraded from 001..013 -> applies 014+ without re-running 001..013.
  const preApplied = new Map();
  for (let i = 1; i <= 13; i += 1) {
    const version = String(i).padStart(3, "0");
    preApplied.set(version, { filename: `${version}_applied.sql`, checksum: null });
  }
  const executedStatements = [];
  const populatedClient = {
    async query(sql, values = []) {
      const text = String(sql).trim();
      if (text.startsWith("SELECT 1 FROM schema_migrations")) {
        return { rowCount: preApplied.has(values[0]) ? 1 : 0, rows: [] };
      }
      if (text.startsWith("SELECT checksum FROM schema_migrations")) {
        const row = preApplied.get(values[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ checksum: row.checksum }] : [] };
      }
      if (text.startsWith("INSERT INTO schema_migrations")) {
        preApplied.set(values[0], { filename: values[1], checksum: values[2] });
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("privacy_data_requests")) {
        executedStatements.push(text);
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const upgradeResult = await runMigrations(populatedClient, migrationsDir);
  assert.equal(upgradeResult.skipped.length, 13);
  assert.ok(upgradeResult.applied.includes("014_privacy_data_requests.sql"));
  assert.ok(
    executedStatements.some((stmt) => stmt.includes("ALTER COLUMN subject_id TYPE TEXT USING subject_id::text")),
    "upgrading a populated DB must execute migration 014's UUID->TEXT safe upgrade block",
  );
});
