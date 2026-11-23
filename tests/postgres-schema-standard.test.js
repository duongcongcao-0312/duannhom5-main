"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("PostgreSQL migrations never use floating-point types for money and use timezone-aware TIMESTAMPTZ", async () => {
  const migrationsDir = path.join(__dirname, "..", "data", "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length >= 25);

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    assert.doesNotMatch(
      sql,
      /\b(?:FLOAT|FLOAT4|FLOAT8|REAL|DOUBLE\s+PRECISION)\b/i,
      `${file} must not use floating-point types`,
    );
    assert.doesNotMatch(
      sql,
      /\bTIMESTAMP\s+WITHOUT\s+TIME\s+ZONE\b/i,
      `${file} must use TIMESTAMPTZ instead of TIMESTAMP WITHOUT TIME ZONE`,
    );
  }
});

test("migration 025 standardizes timestamps and idempotent updated_at triggers without destructive DDL", async () => {
  const mig025 = await fs.readFile(
    path.join(__dirname, "..", "data", "migrations", "025_schema_normalization_timestamps.sql"),
    "utf8",
  );
  assert.match(mig025, /ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(mig025, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(mig025, /CREATE OR REPLACE FUNCTION booknest_touch_updated_at\(\)/);
  assert.match(mig025, /BEFORE UPDATE ON/);
  assert.doesNotMatch(mig025, /\b(?:DELETE|TRUNCATE|DROP TABLE)\b/i);
});

test("PostgreSQL schema standard documentation covers naming, data types, timestamps, and upgrade compatibility", async () => {
  const doc = await fs.readFile(path.join(__dirname, "..", "docs", "postgres-schema-standard.md"), "utf8");
  assert.match(doc, /snake_case/);
  assert.match(doc, /TIMESTAMPTZ/);
  assert.match(doc, /BIGINT/);
  assert.match(doc, /booknest_touch_updated_at/);
});
