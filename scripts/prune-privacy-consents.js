const { Database } = require("../backend/db");
const { PostgresDatabase } = require("../backend/postgres-db");

async function runPrivacyConsentRetention({
  database,
  apply = false,
  asOf = new Date(),
  output = (line) => console.log(line),
} = {}) {
  const timestamp = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("asOf must be a valid date.");
  }
  if (typeof output !== "function") {
    throw new TypeError("output must be a function.");
  }

  const eligible = await database.getExpiredConsentRecordCount(timestamp);
  const pruned = apply
    ? await database.pruneExpiredConsentRecords(timestamp)
    : 0;
  const result = {
    mode: apply ? "apply" : "dry-run",
    asOf: timestamp.toISOString(),
    eligible,
    pruned,
  };
  output(JSON.stringify(result));
  return result;
}

async function main(args) {
  const unknownArguments = args.filter((argument) => argument !== "--apply");
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument: ${unknownArguments[0]}`);
  }
  const database = process.env.DATABASE_URL
    ? new PostgresDatabase()
    : new Database();
  try {
    await runPrivacyConsentRetention({
      database,
      apply: args.includes("--apply"),
    });
  } finally {
    if (typeof database.close === "function") await database.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runPrivacyConsentRetention };
