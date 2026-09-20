import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const module20Migration = "0033_reports_analytics.sql";

/** Returns released migrations through the Module 20 database migration in deterministic order. */
async function migrationSequence() {
  return (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name <= module20Migration)
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

/** Confirms a statement fails with a PostgreSQL constraint or foreign-key error. */
async function expectDatabaseRejection(statement, values, label) {
  try {
    await pool.query(statement, values);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String(error.code).startsWith("23")
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected database rejection: ${label}`);
}

/** Inserts the minimum identity/file fixtures needed to prove Module 20 ownership foreign keys. */
async function createOwnershipFixtures() {
  const userResult = await pool.query(
    `insert into users (email, password_hash, display_name, account_type, status)
     values ('module20-migration@example.test', 'migration-only-hash', 'Module 20 Migration', 'platform_admin', 'active')
     returning id`,
  );
  const userId = userResult.rows[0].id;

  const fileResult = await pool.query(
    `insert into files (
       storage_provider, object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status
     ) values (
       's3_compatible', 'report_export/module20-migration.csv', 'report_export',
       'module20-migration.csv', 'text/csv', 1, $1, 'confirmed'
     ) returning id`,
    [userId],
  );

  return { userId, fileId: fileResult.rows[0].id };
}

/** Verifies the three Module 20 tables, relationships, indexes, and row-local integrity guards. */
async function verifyModule20Shape() {
  for (const tableName of [
    "report_definitions",
    "report_runs",
    "saved_report_filters",
  ]) {
    assertCondition(await tableExists(tableName), `Missing Module 20 table: ${tableName}`);
  }

  for (const indexName of [
    "report_definitions_code_uq",
    "report_definitions_domain_status_idx",
    "report_runs_requester_created_idx",
    "report_runs_report_created_idx",
    "report_runs_status_created_idx",
    "report_runs_file_uq",
    "saved_report_filters_user_report_name_uq",
    "saved_report_filters_user_report_created_idx",
  ]) {
    assertCondition(await indexExists(indexName), `Missing Module 20 index: ${indexName}`);
  }

  for (const [tableName, constraintName] of [
    ["report_runs", "report_runs_report_code_report_definitions_code_fk"],
    ["report_runs", "report_runs_requested_by_users_id_fk"],
    ["report_runs", "report_runs_file_id_files_id_fk"],
    ["saved_report_filters", "saved_report_filters_user_id_users_id_fk"],
    ["saved_report_filters", "saved_report_filters_report_code_report_definitions_code_fk"],
    ["report_definitions", "report_definitions_output_formats_check"],
    ["report_runs", "report_runs_output_format_check"],
    ["report_runs", "report_runs_status_check"],
    ["saved_report_filters", "saved_report_filters_filters_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `Missing Module 20 constraint: ${constraintName}`,
    );
  }

  const requiredPermissions = await columnDefinition(
    "report_definitions",
    "required_permissions",
  );
  assertCondition(
    requiredPermissions?.data_type === "jsonb" && requiredPermissions?.is_nullable === "NO",
    "Report required_permissions must be required JSONB.",
  );

  const filterSchema = await columnDefinition("report_definitions", "filter_schema_json");
  assertCondition(
    filterSchema?.data_type === "jsonb" && filterSchema?.is_nullable === "NO",
    "Report filter_schema_json must be required JSONB.",
  );

  const runOutputFormat = await columnDefinition("report_runs", "output_format");
  assertCondition(
    runOutputFormat?.data_type === "character varying" &&
      runOutputFormat?.character_maximum_length === 10 &&
      runOutputFormat?.is_nullable === "NO",
    "Report run output_format must be a required bounded string.",
  );

  const { userId, fileId } = await createOwnershipFixtures();
  await pool.query(
    `insert into report_definitions (
       code, domain, required_permissions, filter_schema_json, output_formats, status
     ) values (
       'sales', 'sales', '["reports.sales.read"]'::jsonb, '{}'::jsonb, '["csv", "pdf"]'::jsonb, 'active'
     )`,
  );
  const runResult = await pool.query(
    `insert into report_runs (
       report_code, requested_by, filters_json, output_format, status, file_id, started_at, finished_at
     ) values (
       'sales', $1, '{}'::jsonb, 'csv', 'completed', $2, now(), now()
     ) returning id`,
    [userId, fileId],
  );
  assertCondition(Boolean(runResult.rows[0]?.id), "Valid completed report run was not persisted.");

  await pool.query(
    `insert into saved_report_filters (user_id, report_code, name, filters_json)
     values ($1, 'sales', 'Last 30 days', '{"range":"30d"}'::jsonb)`,
    [userId],
  );

  await expectDatabaseRejection(
    `insert into report_definitions (
       code, domain, required_permissions, filter_schema_json, output_formats, status
     ) values ('bad-format', 'sales', '["reports.sales.read"]'::jsonb, '{}'::jsonb, '["xlsx"]'::jsonb, 'active')`,
    [],
    "unapproved export format",
  );
  await expectDatabaseRejection(
    `insert into report_runs (report_code, requested_by, filters_json, output_format, status)
     values ('sales', $1, '{}'::jsonb, 'xlsx', 'queued')`,
    [userId],
    "unapproved report-run export format",
  );
  await expectDatabaseRejection(
    `insert into saved_report_filters (user_id, report_code, name, filters_json)
     values ($1, 'sales', 'Broken filter', '[]'::jsonb)`,
    [userId],
    "non-object saved filter payload",
  );
}

/** Proves both the supported 0032 -> 0033 upgrade and a clean migration history through Module 20 Pass 1. */
async function main() {
  try {
    const migrations = await migrationSequence();
    assertCondition(
      migrations.at(-1) === module20Migration,
      `Expected ${module20Migration} to be the Module 20 migration ceiling.`,
    );

    const preModule20 = migrations.filter((name) => name !== module20Migration);

    await resetSchema();
    for (const migration of preModule20) await applyMigration(migration);
    assertCondition(
      !(await tableExists("report_definitions")),
      "Report tables must not exist before migration 0033.",
    );
    await applyMigration(module20Migration);
    await verifyModule20Shape();

    await resetSchema();
    for (const migration of migrations) await applyMigration(migration);
    await verifyModule20Shape();

    console.log("Module 20 Reports & Analytics migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
