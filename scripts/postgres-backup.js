const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  authenticateBackupManifest,
  decryptBuffer,
  encryptBuffer,
  resolveBackupEncryptionConfig,
  verifyBackupManifestAuthentication,
} = require("./backup-encryption");

const DATABASE_ARCHIVE = "database.dump";

function redactConnectionDetails(message, databaseUrl = "") {
  let redacted = String(message);
  if (databaseUrl) redacted = redacted.split(databaseUrl).join("[REDACTED]");
  return redacted.replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@");
}

function validateDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("Cấu hình PostgreSQL backup cần DATABASE_URL hợp lệ.");
  }
}

function digest(contents) {
  return {
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    bytes: contents.length,
  };
}

function runCommand(command, args, {
  databaseUrl,
  timeoutMs = 30 * 60 * 1000,
  spawnImpl = spawn,
  env = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.DATABASE_URL;
    delete childEnv.PGPASSWORD;
    delete childEnv.PGHOST;
    delete childEnv.PGPORT;
    delete childEnv.PGUSER;
    delete childEnv.PGDATABASE;
    delete childEnv.BACKUP_ENCRYPTION_KEY;
    delete childEnv.BACKUP_ENCRYPTION_REQUIRED;
    if (databaseUrl) childEnv.PGDATABASE = databaseUrl;

    let child;
    try {
      child = spawnImpl(command, args, {
        env: childEnv,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(new Error(`Không thể khởi chạy ${path.basename(command)}: ${redactConnectionDetails(error.message, databaseUrl)}`));
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.toString().slice(0, 16_384 - stderr.length);
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(command)} vượt quá thời gian chờ ${timeoutMs} ms.`));
    }, timeoutMs);
    timeout.unref?.();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Không thể khởi chạy ${path.basename(command)}: ${redactConnectionDetails(error.message, databaseUrl)}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const details = redactConnectionDetails(stderr.trim(), databaseUrl);
      reject(new Error(
        `${path.basename(command)} thất bại (exit=${code ?? "null"}, signal=${signal || "none"})${details ? `: ${details}` : "."}`,
      ));
    });
  });
}

async function createPostgresBackup(databaseUrl, backupDir, now = new Date(), options = {}) {
  validateDatabaseUrl(databaseUrl);
  const encryption = resolveBackupEncryptionConfig(options);
  const parentDir = path.dirname(backupDir);
  const stagingDir = path.join(parentDir, `.${path.basename(backupDir)}-${crypto.randomUUID()}.tmp`);
  await fs.mkdir(parentDir, { recursive: true });
  try {
    await fs.mkdir(stagingDir, { mode: 0o700 });
    const archivePath = path.join(stagingDir, DATABASE_ARCHIVE);
    await (options.runCommand || runCommand)(
      options.pgDumpPath || process.env.PG_DUMP_PATH || "pg_dump",
      ["--format=custom", "--no-owner", "--no-password", "--file", archivePath],
      { ...options, databaseUrl },
    );
    const archive = await fs.readFile(archivePath);
    if (archive.length === 0) throw new Error("pg_dump đã tạo archive rỗng.");
    let files = { [DATABASE_ARCHIVE]: digest(archive) };
    let manifest = {
      format: 2,
      storage: "postgresql",
      createdAt: now.toISOString(),
      files,
    };
    if (encryption.key) {
      const encryptedFile = `${DATABASE_ARCHIVE}.enc`;
      await fs.writeFile(
        path.join(stagingDir, encryptedFile),
        encryptBuffer(archive, encryption.key),
        { mode: 0o600, flag: "wx" },
      );
      await fs.rm(archivePath);
      files = { [DATABASE_ARCHIVE]: { ...digest(archive), encryptedFile } };
      manifest = {
        format: 3,
        storage: "postgresql",
        encrypted: true,
        encryption: { algorithm: "aes-256-gcm", version: 1 },
        createdAt: now.toISOString(),
        files,
      };
    }
    if (!encryption.key) await fs.chmod(archivePath, 0o600);
    if (encryption.key) {
      manifest = authenticateBackupManifest(manifest, encryption.key);
    }
    await fs.writeFile(
      path.join(stagingDir, "manifest.json"),
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

async function verifyPostgresBackup(backupDir, manifest, options = {}) {
  const encrypted = manifest?.format === 3 && manifest.encrypted === true;
  const encryption = resolveBackupEncryptionConfig(options);
  if (
    (manifest?.format !== 2 && !encrypted) ||
    manifest.storage !== "postgresql" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !manifest.files ||
    Object.keys(manifest.files).length !== 1 ||
    !manifest.files[DATABASE_ARCHIVE]
  ) {
    throw new Error("Manifest backup PostgreSQL không đúng định dạng.");
  }
  if (encryption.required && !encrypted) {
    throw new Error("BACKUP_ENCRYPTION_REQUIRED yêu cầu archive PostgreSQL được mã hóa.");
  }
  if (encrypted && !encryption.key) {
    throw new Error("BACKUP_ENCRYPTION_KEY là bắt buộc để xác minh backup PostgreSQL mã hóa.");
  }
  if (
    encrypted &&
    (
      manifest.encryption?.algorithm !== "aes-256-gcm" ||
      manifest.encryption?.version !== 1 ||
      manifest.files[DATABASE_ARCHIVE].encryptedFile !== `${DATABASE_ARCHIVE}.enc`
    )
  ) {
    throw new Error("Manifest backup PostgreSQL mã hóa không đúng định dạng.");
  }
  if (
    encrypted &&
    !verifyBackupManifestAuthentication(manifest, encryption.key)
  ) {
    throw new Error("Xác thực manifest backup PostgreSQL thất bại.");
  }
  const expected = manifest.files[DATABASE_ARCHIVE];
  if (
    typeof expected.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    !Number.isInteger(expected.bytes) ||
    expected.bytes <= 0
  ) {
    throw new Error("Manifest archive PostgreSQL không hợp lệ.");
  }
  await withVerifiedPostgresArchive(backupDir, manifest, options, async (archivePath) => {
    await (options.runCommand || runCommand)(
      options.pgRestorePath || process.env.PG_RESTORE_PATH || "pg_restore",
      ["--list", archivePath],
      options,
    );
  });
  return manifest;
}

async function restorePostgresBackup(backupDir, databaseUrl, options = {}) {
  validateDatabaseUrl(databaseUrl);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(backupDir, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`Backup PostgreSQL không có manifest hợp lệ: ${error.message}`);
  }
  await verifyPostgresBackup(backupDir, manifest, options);
  await withVerifiedPostgresArchive(backupDir, manifest, options, async (archivePath) => {
    await (options.runCommand || runCommand)(
      options.pgRestorePath || process.env.PG_RESTORE_PATH || "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--exit-on-error",
        "--no-owner",
        "--no-password",
        archivePath,
      ],
      { ...options, databaseUrl },
    );
  });
  return manifest;
}

async function withVerifiedPostgresArchive(backupDir, manifest, options, operation) {
  const encrypted = manifest.format === 3;
  const expected = manifest.files[DATABASE_ARCHIVE];
  const storedPath = path.join(
    backupDir,
    encrypted ? expected.encryptedFile : DATABASE_ARCHIVE,
  );
  let stored;
  try {
    stored = await fs.readFile(storedPath);
  } catch (error) {
    throw new Error(`Không đọc được archive PostgreSQL: ${error.message}`);
  }
  const contents = encrypted
    ? decryptBuffer(stored, resolveBackupEncryptionConfig(options).key)
    : stored;
  const actual = digest(contents);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
    throw new Error("Kiểm tra toàn vẹn thất bại cho database.dump.");
  }
  if (!encrypted) return operation(storedPath);

  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-pg-restore-"));
  const temporaryArchive = path.join(temporaryDir, DATABASE_ARCHIVE);
  try {
    await fs.writeFile(temporaryArchive, contents, { mode: 0o600, flag: "wx" });
    return await operation(temporaryArchive);
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
}

module.exports = {
  createPostgresBackup,
  restorePostgresBackup,
  runCommand,
  redactConnectionDetails,
  validateDatabaseUrl,
  verifyPostgresBackup,
};
