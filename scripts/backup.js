const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");

const DATA_FILES = [
  "users.json",
  "customers.json",
  "books.json",
  "orders.jsonl",
  "service-requests.jsonl",
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

  await fs.mkdir(backupDir, { recursive: true });
  const manifest = {
    format: 1,
    createdAt: now.toISOString(),
    files: {},
  };
  for (const name of files) {
    const source = path.join(dataDir, name);
    await fs.copyFile(source, path.join(backupDir, name));
    manifest.files[name] = await digest(source);
  }
  await fs.writeFile(
    path.join(backupDir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function verifyBackup(backupDir) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(backupDir, MANIFEST_FILE), "utf8"));
  } catch (error) {
    throw new Error(`Backup không có manifest hợp lệ: ${error.message}`);
  }
  if (!manifest || manifest.format !== 1 || !manifest.files || typeof manifest.files !== "object") {
    throw new Error("Manifest backup không đúng định dạng.");
  }

  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!DATA_FILES.includes(name) || !expected || typeof expected.sha256 !== "string" || !Number.isInteger(expected.bytes)) {
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
  await fs.mkdir(dataDir, { recursive: true });
  for (const name of Object.keys(manifest.files)) {
    await fs.copyFile(path.join(backupDir, name), path.join(dataDir, name));
  }
  return manifest;
}

async function main(args) {
  const command = args[0];
  const root = path.resolve(__dirname, "..");
  const dataDir = process.env.DATA_DIR || path.join(root, "data");
  const backupDir = args[1] && path.resolve(args[1]);

  if (!["create", "verify", "restore"].includes(command)) {
    throw new Error(
      "Cú pháp: node scripts/backup.js create <backup-dir> | verify <backup-dir> | restore <backup-dir> <data-dir> --confirm",
    );
  }
  if (!backupDir) throw new Error("Thiếu thư mục backup.");
  if (command === "create") {
    await createBackup(dataDir, backupDir);
    console.log(`Đã tạo backup tại ${backupDir}.`);
  } else if (command === "verify") {
    await verifyBackup(backupDir);
    console.log(`Backup hợp lệ: ${backupDir}.`);
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
