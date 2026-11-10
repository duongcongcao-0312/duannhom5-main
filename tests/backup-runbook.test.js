const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBackup, restoreBackup, verifyBackup } = require("../scripts/backup");
const {
  createPostgresBackup,
  restorePostgresBackup,
  runCommand,
} = require("../scripts/postgres-backup");
const {
  loadBackupConfig,
  pruneOldBackups,
  runBackupCycle,
  startBackupScheduler,
  writeLog,
} = require("../scripts/backup-scheduler");

test("backup create, verify, and restore succeeds with a manifest", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-success-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backup");
  const restoredDir = path.join(root, "restored");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, "users.json"), '[{"id":"admin"}]\n');
  await fs.writeFile(path.join(dataDir, "orders.jsonl"), '{"id":"order-1"}\n');
  await fs.writeFile(path.join(dataDir, "coupons.json"), '[{"code":"WELCOME5"}]\n');
  await fs.writeFile(path.join(dataDir, "customer-interactions.json"), "[]\n");

  const manifest = await createBackup(dataDir, backupDir, new Date("2026-11-02T00:00:00Z"));
  assert.equal(Object.keys(manifest.files).length, 4);
  await verifyBackup(backupDir);
  await restoreBackup(backupDir, restoredDir);
  assert.equal(await fs.readFile(path.join(restoredDir, "users.json"), "utf8"), '[{"id":"admin"}]\n');
  assert.equal(await fs.readFile(path.join(restoredDir, "orders.jsonl"), "utf8"), '{"id":"order-1"}\n');
  assert.equal(await fs.readFile(path.join(restoredDir, "coupons.json"), "utf8"), '[{"code":"WELCOME5"}]\n');
  assert.equal(await fs.readFile(path.join(restoredDir, "customer-interactions.json"), "utf8"), "[]\n");
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

test("backup scheduler validates configuration and keeps only managed backups within retention", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-retention-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backups");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, "users.json"), "[]\n");
  await fs.mkdir(backupDir);
  await fs.mkdir(path.join(backupDir, "booknest-operator-data"));

  const config = loadBackupConfig({
    DATA_DIR: dataDir,
    BACKUP_DIR: backupDir,
    BACKUP_INTERVAL_HOURS: "12",
    BACKUP_RETENTION_DAYS: "7",
  }, root);
  assert.equal(config.intervalMs, 12 * 60 * 60 * 1000);
  assert.equal(config.retentionMs, 7 * 24 * 60 * 60 * 1000);
  assert.throws(() => loadBackupConfig({
    DATA_DIR: dataDir,
    BACKUP_DIR: path.join(dataDir, "backups"),
  }, root), /không được trùng nhau hoặc lồng nhau/);
  assert.throws(() => loadBackupConfig({
    BACKUP_INTERVAL_HOURS: "0",
  }, root), /BACKUP_INTERVAL_HOURS/);
  assert.throws(() => loadBackupConfig({
    BACKUP_ALERT_WEBHOOK_URL: "http://alerts.example.test/hook",
  }, root), /phải dùng HTTPS/);

  const now = new Date("2026-11-11T00:00:00.000Z");
  const backupNames = [];
  for (let day = 0; day < 4; day += 1) {
    const createdAt = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
    const name = `booknest-${createdAt.toISOString().replace(/[-:.]/g, "")}`;
    backupNames.push(name);
    await createBackup(dataDir, path.join(backupDir, name), createdAt);
  }
  const removed = await pruneOldBackups({
    ...config,
    retentionMs: 2 * 24 * 60 * 60 * 1000,
  }, now.getTime());
  assert.deepEqual(removed, [backupNames[3]]);
  assert.deepEqual(
    (await fs.readdir(backupDir)).filter((name) => name.startsWith("booknest-")).sort(),
    [...backupNames.slice(0, 3), "booknest-operator-data"].sort(),
  );
});

test("scheduled backup verifies, logs completion, and alerts with redacted failure context", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-cycle-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backups");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, "users.json"), "[]\n");
  const config = loadBackupConfig({
    DATA_DIR: dataDir,
    BACKUP_DIR: backupDir,
    BACKUP_ALERT_WEBHOOK_URL: "https://alerts.example.test/hook",
  }, root);
  const records = [];
  const logged = async (_config, event, details) => records.push({ event, ...details });
  const backupPath = await runBackupCycle(config, {
    now: "2026-11-11T00:00:00.000Z",
    log: logged,
  });
  assert.equal(await verifyBackup(backupPath).then((manifest) => manifest.files["users.json"].bytes), 3);
  assert.equal(records[0].event, "backup_succeeded");

  const secret = "postgres://backup-user:private-password@db.example.test/store";
  const delivered = [];
  await assert.rejects(
    runBackupCycle(config, {
      now: "2026-11-12T00:00:00.000Z",
      env: { DATABASE_URL: secret },
      log: logged,
      createBackup: async () => { throw new Error(`dump failed for ${secret}`); },
      fetch: async (_url, request) => {
        delivered.push(JSON.parse(request.body));
        return { ok: true, status: 200 };
      },
    }),
    /dump failed/,
  );
  const failure = records.find((record) => record.event === "backup_failed");
  assert.ok(failure);
  assert.equal(failure.message.includes("private-password"), false);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.includes("private-password"), false);
});

test("backup scheduler runs immediately and stops its timer cleanly", async () => {
  let runs = 0;
  const scheduler = startBackupScheduler({ intervalMs: 60_000 }, {
    runCycle: async () => { runs += 1; },
  });
  while (runs === 0) await new Promise((resolve) => setImmediate(resolve));
  scheduler.stop();
  await scheduler.done;
  assert.equal(runs, 1);
});

test("PostgreSQL backup, verification, and restore keep connection credentials out of arguments", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-postgres-backup-"));
  const backupDir = path.join(root, "booknest-20261111T000000000Z");
  const databaseUrl = "postgres://backup-user:private-password@db.example.test/store";
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commands = [];
  const runProcess = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pg_dump") {
      await fs.writeFile(args[args.indexOf("--file") + 1], "verified-database-archive");
    }
  };

  const manifest = await createPostgresBackup(databaseUrl, backupDir, new Date("2026-11-11T00:00:00Z"), {
    runCommand: runProcess,
  });
  assert.equal(manifest.storage, "postgresql");
  await verifyBackup(backupDir, { runCommand: runProcess });
  await restorePostgresBackup(backupDir, databaseUrl, { runCommand: runProcess });
  assert.equal(commands.length, 4);
  for (const command of commands) {
    assert.equal(command.args.includes(databaseUrl), false);
    if (command.options.databaseUrl) {
      assert.equal(command.options.databaseUrl, databaseUrl);
    }
  }
  assert.equal(commands[0].command, "pg_dump");
  assert.deepEqual(commands[1].args.slice(0, 1), ["--list"]);
  assert.deepEqual(commands[0].args.slice(0, 3), ["--format=custom", "--no-owner", "--no-password"]);
  assert.deepEqual(commands[3].args.slice(0, 5), [
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "--no-owner",
    "--no-password",
  ]);
});

test("PostgreSQL child process receives connection details only through its environment", async () => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const databaseUrl = "postgres://backup-user:private-password@db.example.test/store";
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => child.emit("close", 0, null));
    return child;
  };
  await runCommand("pg_dump", ["--format=custom"], {
    databaseUrl,
    env: { DATABASE_URL: databaseUrl, PGPASSWORD: "should-not-be-forwarded" },
    spawnImpl,
    timeoutMs: 1000,
  });
  assert.equal(invocation.options.env.PGDATABASE, databaseUrl);
  assert.equal("DATABASE_URL" in invocation.options.env, false);
  assert.equal("PGPASSWORD" in invocation.options.env, false);
  assert.equal(invocation.args.includes(databaseUrl), false);

  const failedSpawn = (_command, _args, options) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stderr.end(`connection failed for ${databaseUrl}`);
      child.emit("close", 1, null);
    });
    invocation = { options };
    return child;
  };
  await assert.rejects(
    runCommand("pg_dump", [], { databaseUrl, spawnImpl: failedSpawn, timeoutMs: 1000 }),
    (error) => !error.message.includes("private-password") && error.message.includes("[REDACTED]"),
  );
});

test("backup logs are persisted as JSON Lines with secret values redacted", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-backup-log-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logFile = path.join(root, "backup.log");
  const config = { logFile };
  const secret = "postgres://backup-user:private-password@db.example.test/store";
  await writeLog(config, "backup_failed", {
    message: `pg_dump failed: ${secret}`,
  }, { DATABASE_URL: secret });
  const content = await fs.readFile(logFile, "utf8");
  const record = JSON.parse(content);
  assert.equal(record.event, "backup_failed");
  assert.equal(record.message.includes("private-password"), false);
  assert.match(record.message, /\[REDACTED\]/);
});

test("scheduled backup selects PostgreSQL when DATABASE_URL is configured", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-postgres-schedule-"));
  const databaseUrl = "postgres://backup-user:private-password@db.example.test/store";
  const backupDir = path.join(root, "backups");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = loadBackupConfig({
    DATA_DIR: path.join(root, "data"),
    BACKUP_DIR: backupDir,
    DATABASE_URL: databaseUrl,
  }, root);
  const records = [];
  const runProcess = async (command, args) => {
    if (command === "pg_dump") {
      await fs.writeFile(args[args.indexOf("--file") + 1], "database-archive");
    }
  };
  const backupPath = await runBackupCycle(config, {
    now: "2026-11-11T00:00:00.000Z",
    log: async (_config, event, details) => records.push({ event, ...details }),
    pgRunCommand: runProcess,
  });
  assert.equal(path.basename(backupPath), "booknest-20261111T000000000Z");
  assert.equal(records[0].storage, "postgresql");
  assert.equal(records[0].event, "backup_succeeded");
});
