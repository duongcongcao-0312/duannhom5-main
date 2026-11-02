const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBackup, restoreBackup, verifyBackup } = require("../scripts/backup");

test("backup create, verify, and restore succeeds with a manifest", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-success-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backup");
  const restoredDir = path.join(root, "restored");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, "users.json"), '[{"id":"admin"}]\n');
  await fs.writeFile(path.join(dataDir, "orders.jsonl"), '{"id":"order-1"}\n');

  const manifest = await createBackup(dataDir, backupDir, new Date("2026-11-02T00:00:00Z"));
  assert.equal(Object.keys(manifest.files).length, 2);
  await verifyBackup(backupDir);
  await restoreBackup(backupDir, restoredDir);
  assert.equal(await fs.readFile(path.join(restoredDir, "users.json"), "utf8"), '[{"id":"admin"}]\n');
});

test("backup verification fails when a file is changed or missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-failure-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backup");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, "users.json"), "[]\n");
  await createBackup(dataDir, backupDir);

  await fs.writeFile(path.join(backupDir, "users.json"), "[corrupt]\n");
  await assert.rejects(verifyBackup(backupDir), /toàn vẹn thất bại/);
  await fs.rm(path.join(backupDir, "users.json"));
  await assert.rejects(verifyBackup(backupDir), /Không đọc được users\.json/);
});
