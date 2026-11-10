const fs = require("node:fs/promises");
const path = require("node:path");
const { createBackup, verifyBackup } = require("./backup");
const { createPostgresBackup, validateDatabaseUrl } = require("./postgres-backup");

const BACKUP_PREFIX = "booknest-";
const MIN_RETAINED_BACKUPS = 2;

function pathsOverlap(left, right) {
  const leftRelative = path.relative(left, right);
  const rightRelative = path.relative(right, left);
  return leftRelative === "" || rightRelative === "" ||
    (!leftRelative.startsWith(`..${path.sep}`) && leftRelative !== ".." && !path.isAbsolute(leftRelative)) ||
    (!rightRelative.startsWith(`..${path.sep}`) && rightRelative !== ".." && !path.isAbsolute(rightRelative));
}

function positiveInteger(value, name, fallback, maximum) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} phải là số nguyên từ 1 đến ${maximum}.`);
  }
  return parsed;
}

function loadBackupConfig(env = process.env, root = path.resolve(__dirname, "..")) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(root, "data"));
  const backupDir = path.resolve(env.BACKUP_DIR || path.join(root, "backups"));
  if (pathsOverlap(dataDir, backupDir)) {
    throw new Error("BACKUP_DIR và DATA_DIR không được trùng nhau hoặc lồng nhau.");
  }

  const alertWebhookUrl = env.BACKUP_ALERT_WEBHOOK_URL || "";
  if (alertWebhookUrl) {
    let parsed;
    try {
      parsed = new URL(alertWebhookUrl);
    } catch {
      throw new Error("BACKUP_ALERT_WEBHOOK_URL không phải URL hợp lệ.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("BACKUP_ALERT_WEBHOOK_URL phải dùng HTTPS và không nhúng thông tin đăng nhập.");
    }
  }

  const intervalHours = positiveInteger(env.BACKUP_INTERVAL_HOURS, "BACKUP_INTERVAL_HOURS", 24, 8760);
  const retentionDays = positiveInteger(env.BACKUP_RETENTION_DAYS, "BACKUP_RETENTION_DAYS", 30, 3650);
  const logFile = path.resolve(env.BACKUP_LOG_FILE || path.join(backupDir, "backup.log"));
  const timeoutMs = positiveInteger(env.BACKUP_ALERT_TIMEOUT_MS, "BACKUP_ALERT_TIMEOUT_MS", 10000, 120000);
  const databaseUrl = env.DATABASE_URL || "";
  if (databaseUrl) validateDatabaseUrl(databaseUrl);
  const databaseBackupTimeoutMs = positiveInteger(
    env.DATABASE_BACKUP_TIMEOUT_MS,
    "DATABASE_BACKUP_TIMEOUT_MS",
    30 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );
  return {
    dataDir,
    backupDir,
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    retentionDays,
    retentionMs: retentionDays * 24 * 60 * 60 * 1000,
    logFile,
    alertWebhookUrl,
    timeoutMs,
    databaseUrl,
    pgOptions: {
      timeoutMs: databaseBackupTimeoutMs,
      pgDumpPath: env.PG_DUMP_PATH || "pg_dump",
      pgRestorePath: env.PG_RESTORE_PATH || "pg_restore",
    },
  };
}

function redactSecrets(message, env = process.env) {
  let redacted = String(message);
  for (const name of ["DATABASE_URL", "ADMIN_PASSWORD", "SMTP_PASS", "RESEND_API_KEY", "BACKUP_ALERT_WEBHOOK_URL"]) {
    const secret = env[name];
    if (typeof secret === "string" && secret.length >= 6) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted.replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@");
}

async function writeLog(config, event, details = {}, env = process.env) {
  const record = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };
  const line = `${JSON.stringify(record, (key, value) => (
    typeof value === "string" ? redactSecrets(value, env) : value
  ))}\n`;
  if (event === "backup_failed" || event === "backup_alert_failed") {
    console.error(line.trimEnd());
  } else {
    console.log(line.trimEnd());
  }
  try {
    await fs.mkdir(path.dirname(config.logFile), { recursive: true });
    await fs.appendFile(config.logFile, line, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(config.logFile, 0o600);
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "backup_log_write_failed",
      message: redactSecrets(error.message, env),
    }));
    throw error;
  }
}

async function listManagedBackups(config, options = {}) {
  let entries;
  try {
    entries = await fs.readdir(config.backupDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^booknest-\d{8}T\d{9}Z$/.test(entry.name)) continue;
    const directory = path.join(config.backupDir, entry.name);
    const manifest = await verifyBackup(directory, {
      ...config.pgOptions,
      ...options,
    });
    const createdAt = Date.parse(manifest.createdAt);
    if (!Number.isFinite(createdAt)) {
      throw new Error(`Ngày tạo backup không hợp lệ: ${entry.name}.`);
    }
    backups.push({ directory, name: entry.name, createdAt });
  }
  return backups.sort((left, right) => right.createdAt - left.createdAt);
}

async function pruneOldBackups(config, now = Date.now(), options = {}) {
  const backups = await listManagedBackups(config, options);
  const keep = new Set(backups.slice(0, MIN_RETAINED_BACKUPS).map((backup) => backup.directory));
  const removed = [];
  for (const backup of backups) {
    if (keep.has(backup.directory) || now - backup.createdAt <= config.retentionMs) continue;
    await fs.rm(backup.directory, { recursive: true, force: false });
    removed.push(backup.name);
  }
  return removed;
}

async function sendFailureAlert(config, payload, dependencies = {}) {
  if (!config.alertWebhookUrl) return;
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  try {
    const response = await fetchImpl(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) throw new Error(`Alert endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    const message = redactSecrets(error.message, dependencies.env || process.env);
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "backup_alert_failed",
      message,
    }));
    try {
      await writeLog(config, "backup_alert_failed", { message }, dependencies.env || process.env);
    } catch {
      // The console error above is the fallback when the configured log is unavailable.
    }
  }
}

async function runBackupCycle(config, dependencies = {}) {
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  const backupName = `${BACKUP_PREFIX}${now.toISOString().replace(/[-:.]/g, "")}`;
  const backupPath = path.join(config.backupDir, backupName);
  const log = dependencies.log || writeLog;
  const loggingEnv = {
    ...process.env,
    ...(dependencies.env || {}),
    ...(config.databaseUrl ? { DATABASE_URL: config.databaseUrl } : {}),
    ...(config.alertWebhookUrl ? { BACKUP_ALERT_WEBHOOK_URL: config.alertWebhookUrl } : {}),
  };
  try {
    if (config.databaseUrl) {
      await (dependencies.createPostgresBackup || createPostgresBackup)(
        config.databaseUrl,
        backupPath,
        now,
        { ...config.pgOptions, runCommand: dependencies.pgRunCommand },
      );
    } else {
      await (dependencies.createBackup || createBackup)(config.dataDir, backupPath, now);
    }
    await (dependencies.verifyBackup || ((directory) => verifyBackup(directory, {
      ...config.pgOptions,
      runCommand: dependencies.pgRunCommand,
    })))(backupPath);
    const pruned = await pruneOldBackups(config, now.getTime(), {
      runCommand: dependencies.pgRunCommand,
    });
    await log(config, "backup_succeeded", {
      backup: backupName,
      storage: config.databaseUrl ? "postgresql" : "file",
      retentionRemoved: pruned,
    }, loggingEnv);
    return backupPath;
  } catch (error) {
    const message = redactSecrets(error.message, loggingEnv);
    try {
      await log(config, "backup_failed", {
        backup: backupName,
        message,
      }, loggingEnv);
    } catch (loggingError) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "backup_failure_logging_failed",
        message: redactSecrets(loggingError.message, loggingEnv),
      }));
    }
    await sendFailureAlert(config, {
      event: "backup_failed",
      timestamp: now.toISOString(),
      backup: backupName,
      message,
      text: `BookNest backup failed: ${backupName}. ${message}`,
      content: `BookNest backup failed: ${backupName}. ${message}`,
    }, { ...dependencies, env: loggingEnv });
    throw error;
  }
}

function startBackupScheduler(config, dependencies = {}) {
  let stopped = false;
  let timer;
  let wakeTimer;

  const done = (async () => {
    while (!stopped) {
      try {
        await (dependencies.runCycle || runBackupCycle)(config, dependencies);
      } catch {
        // The cycle has already logged the failure and attempted to send an alert.
      }
      if (stopped) break;
      await new Promise((resolve) => {
        wakeTimer = resolve;
        timer = setTimeout(resolve, config.intervalMs);
      });
    }
  })();

  return {
    done,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (wakeTimer) wakeTimer();
    },
  };
}

module.exports = {
  loadBackupConfig,
  pruneOldBackups,
  runBackupCycle,
  sendFailureAlert,
  startBackupScheduler,
  writeLog,
};
