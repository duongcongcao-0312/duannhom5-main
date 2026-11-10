const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  createPostgresBackup,
  restorePostgresBackup,
  verifyPostgresBackup,
} = require("./postgres-backup");

const DATA_FILES = [
  "users.json",
  "customers.json",
  "books.json",
  "coupons.json",
  "orders.jsonl",
  "service-requests.jsonl",
  "customer-interactions.json",
];
const MANIFEST_FILE = "manifest.json";

async function digest(filePath) {
  const contents = await fs.readFile(filePath);
  return {
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    bytes: contents.length,
  };
}

async function existingDataFiles(dataDir) {
  const files = [];
  for (const name of DATA_FILES) {
    try {
      const stats = await fs.stat(path.join(dataDir, name));
      if (stats.isFile()) files.push(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

async function createBackup(dataDir, backupDir, now = new Date()) {
  const files = await existingDataFiles(dataDir);
  if (files.length === 0) {
    throw new Error(`Không tìm thấy tệp dữ liệu trong ${dataDir}.`);
  }

  const parentDir = path.dirname(backupDir);
  const stagingDir = path.join(parentDir, `.${path.basename(backupDir)}-${crypto.randomUUID()}.tmp`);
  await fs.mkdir(parentDir, { recursive: true });
  try {
    await fs.mkdir(stagingDir, { mode: 0o700 });
    const manifest = {
      format: 1,
      createdAt: now.toISOString(),
      files: {},
    };
    for (const name of files) {
      const source = path.join(dataDir, name);
      const before = await digest(source);
      const destination = path.join(stagingDir, name);
      await fs.copyFile(source, destination);
      const [after, copied] = await Promise.all([digest(source), digest(destination)]);
      if (before.sha256 !== after.sha256 || before.sha256 !== copied.sha256) {
        throw new Error(`Dữ liệu thay đổi trong khi sao lưu: ${name}. Hãy tạm dừng ghi dữ liệu và thử lại.`);
      }
      manifest.files[name] = copied;
      await fs.chmod(destination, 0o600);
    }
    await fs.writeFile(
      path.join(stagingDir, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await fs.rename(stagingDir, backupDir);
    return manifest;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function verifyBackup(backupDir, options = {}) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(backupDir, MANIFEST_FILE), "utf8"));
  } catch (error) {
    throw new Error(`Backup không có manifest hợp lệ: ${error.message}`);
  }
  if (manifest?.format === 2 && manifest.storage === "postgresql") {
    return verifyPostgresBackup(backupDir, manifest, options);
  }
  if (
    !manifest ||
    manifest.format !== 1 ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files) ||
    Object.keys(manifest.files).length === 0
  ) {
    throw new Error("Manifest backup không đúng định dạng.");
  }

  for (const [name, expected] of Object.entries(manifest.files)) {
    if (
      !DATA_FILES.includes(name) ||
      !expected ||
      typeof expected.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      !Number.isInteger(expected.bytes) ||
      expected.bytes < 0
    ) {
      throw new Error(`Manifest chứa mục dữ liệu không hợp lệ: ${name}.`);
    }
    const actual = await digest(path.join(backupDir, name)).catch((error) => {
      throw new Error(`Không đọc được ${name}: ${error.message}`);
    });
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new Error(`Kiểm tra toàn vẹn thất bại cho ${name}.`);
    }
  }
  return manifest;
}

async function restoreBackup(backupDir, dataDir) {
  const manifest = await verifyBackup(backupDir);
  if (manifest.storage === "postgresql") {
    throw new Error("Backup PostgreSQL cần được khôi phục bằng lệnh restore-postgres.");
  }
  await fs.mkdir(dataDir, { recursive: true });
  for (const name of Object.keys(manifest.files)) {
    const restoredPath = path.join(dataDir, name);
    await fs.copyFile(path.join(backupDir, name), restoredPath);
    const restored = await digest(restoredPath);
    const expected = manifest.files[name];
    if (restored.sha256 !== expected.sha256 || restored.bytes !== expected.bytes) {
      throw new Error(`Kiểm tra toàn vẹn sau khôi phục thất bại cho ${name}.`);
    }
  }
  return manifest;
}

async function main(args) {
  const command = args[0];
  const root = path.resolve(__dirname, "..");
  const dataDir = process.env.DATA_DIR || path.join(root, "data");
  const backupDir = args[1] && path.resolve(args[1]);

  if (command === "schedule") {
    const { loadBackupConfig, startBackupScheduler } = require("./backup-scheduler");
    const config = loadBackupConfig(process.env, root);
    console.log(JSON.stringify({
      event: "backup_scheduler_started",
      intervalHours: config.intervalHours,
      retentionDays: config.retentionDays,
      backupDir: config.backupDir,
      logFile: config.logFile,
    }));
    const scheduler = startBackupScheduler(config);
    const stop = () => {
      console.log(JSON.stringify({ event: "backup_scheduler_stopping" }));
      scheduler.stop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await scheduler.done;
    return;
  }
  if (!["create", "verify", "restore", "restore-postgres"].includes(command)) {
    throw new Error(
      "Cú pháp: node scripts/backup.js create <backup-dir> | verify <backup-dir> | restore <backup-dir> <data-dir> --confirm | restore-postgres <backup-dir> --confirm | schedule",
    );
  }
  if (!backupDir) throw new Error("Thiếu thư mục backup.");
  if (command === "create") {
    if (process.env.DATABASE_URL) {
      await createPostgresBackup(process.env.DATABASE_URL, backupDir);
    } else {
      await createBackup(dataDir, backupDir);
    }
    await verifyBackup(backupDir);
    console.log(`Đã tạo backup tại ${backupDir}.`);
  } else if (command === "verify") {
    await verifyBackup(backupDir);
    console.log(`Backup hợp lệ: ${backupDir}.`);
  } else if (command === "restore-postgres") {
    if (!args.includes("--confirm")) {
      throw new Error("Restore PostgreSQL cần cờ --confirm vì thao tác có thể thay thế dữ liệu database đích.");
    }
    const manifest = await restorePostgresBackup(backupDir, process.env.DATABASE_URL || "");
    console.log(`Đã khôi phục PostgreSQL từ backup ${manifest.createdAt}.`);
  } else {
    const targetDir = args[2] && path.resolve(args[2]);
    if (!targetDir || !args.includes("--confirm")) {
      throw new Error("Restore cần thư mục dữ liệu và cờ --confirm.");
    }
    await restoreBackup(backupDir, targetDir);
    console.log(`Đã khôi phục dữ liệu vào ${targetDir}.`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Backup thất bại: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createBackup, restoreBackup, verifyBackup };
