import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const module18Migration = "0032_notifications.sql";

/** Returns released migrations through the Module 18 database migration in deterministic order. */
async function migrationSequence() {
  return (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name <= module18Migration)
    .sort();
}

/** Resets the disposable PostgreSQL public schema before one migration scenario. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed SQL migration using the repository statement separator. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

/** Throws one focused migration verification error when a condition is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one public table exists in the disposable database. */
async function tableExists(tableName) {
  const result = await pool.query("select to_regclass($1) as table_name", [
    `public.${tableName}`,
  ]);
  return result.rows[0]?.table_name === tableName;
}

/** Returns whether one named public index exists. */
async function indexExists(indexName) {
  const result = await pool.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = $1`,
    [indexName],
  );
  return result.rowCount === 1;
}

/** Returns whether one named table constraint exists. */
async function constraintExists(tableName, constraintName) {
  const result = await pool.query(
    `select 1
       from information_schema.table_constraints
      where table_schema = 'public' and table_name = $1 and constraint_name = $2`,
    [tableName, constraintName],
  );
  return result.rowCount === 1;
}

/** Returns database metadata for one public column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, character_maximum_length
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies the four Module 18 tables and their ownership/idempotency-critical persistence rules. */
async function verifyModule18Shape() {
  for (const tableName of [
    "notification_templates",
    "notifications",
    "notification_deliveries",
    "notification_preferences",
  ]) {
    assertCondition(await tableExists(tableName), `Missing Module 18 table: ${tableName}`);
  }

  assertCondition(
    await indexExists("notification_templates_code_channel_version_uq"),
    "Notification template versions must be unique per code/channel/version.",
  );
  assertCondition(
    await indexExists("notification_templates_one_active_uq"),
    "Only one active Notification template version may exist per code/channel.",
  );
  assertCondition(
    await indexExists("notification_deliveries_event_user_channel_uq"),
    "Notification delivery retries must be idempotent per source event/user/channel.",
  );
  assertCondition(
    await constraintExists(
      "notification_deliveries",
      "notification_deliveries_source_event_id_outbox_events_id_fk",
    ),
    "Durable Notification delivery rows must reference a committed Foundation outbox event.",
  );
  assertCondition(
    await constraintExists("notification_preferences", "notification_preferences_pk"),
    "Notification preference identity must be user/event/channel.",
  );
  assertCondition(
    await constraintExists("notification_templates", "notification_templates_channel_check"),
    "Notification template channels must stay limited to in_app/email.",
  );
  assertCondition(
    await constraintExists("notification_deliveries", "notification_deliveries_status_check"),
    "Notification delivery lifecycle values must stay bounded.",
  );

  const sourceEventId = await columnDefinition("notification_deliveries", "source_event_id");
  assertCondition(
    sourceEventId?.data_type === "uuid" && sourceEventId?.is_nullable === "NO",
    "Notification source_event_id must be a required UUID.",
  );

  const destinationMasked = await columnDefinition(
    "notification_deliveries",
    "destination_masked",
  );
  assertCondition(
    destinationMasked?.data_type === "character varying" &&
      destinationMasked?.character_maximum_length === 320 &&
      destinationMasked?.is_nullable === "NO",
    "Notification destinations must be stored only in the required masked field.",
  );

  const dataJson = await columnDefinition("notifications", "data_json");
  assertCondition(
    dataJson?.data_type === "jsonb" && dataJson?.is_nullable === "NO",
    "In-app Notification data_json must be required JSONB.",
  );
}

/** Proves both the supported 0031 -> 0032 upgrade and a clean migration history through Module 18. */
async function main() {
  try {
    const migrations = await migrationSequence();
    assertCondition(
      migrations.at(-1) === module18Migration,
      `Expected ${module18Migration} to be the Module 18 migration ceiling.`,
    );

    const preModule18 = migrations.filter((name) => name !== module18Migration);

    await resetSchema();
    for (const migration of preModule18) await applyMigration(migration);
    assertCondition(
      !(await tableExists("notification_templates")),
      "Notification tables must not exist before migration 0032.",
    );
    await applyMigration(module18Migration);
    await verifyModule18Shape();

    await resetSchema();
    for (const migration of migrations) await applyMigration(migration);
    await verifyModule18Shape();

    console.log("Module 18 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
