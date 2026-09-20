import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const module1Migration = "0034_dashboard.sql";

/** Returns released migrations through the Module 1 Dashboard migration in deterministic order. */
async function migrationSequence() {
  return (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name <= module1Migration)
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

/** Confirms one SQL statement fails with a PostgreSQL integrity constraint error. */
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

/** Creates the minimum user, seller, and store fixtures needed to prove Dashboard ownership rules. */
async function createDashboardFixtures(label) {
  const dashboardUserResult = await pool.query(
    `insert into users (email, password_hash, display_name, account_type, status)
     values ($1, 'migration-only-hash', 'Dashboard User', 'platform_admin', 'active')
     returning id`,
    [`dashboard-${label}@example.test`],
  );
  const dashboardUserId = dashboardUserResult.rows[0].id;

  const sellerOwnerResult = await pool.query(
    `insert into users (email, password_hash, display_name, account_type, status)
     values ($1, 'migration-only-hash', 'Dashboard Seller', 'seller', 'active')
     returning id`,
    [`dashboard-seller-${label}@example.test`],
  );
  const sellerOwnerId = sellerOwnerResult.rows[0].id;

  const sellerResult = await pool.query(
    `insert into sellers (
       owner_user_id, legal_name, display_name, status, approval_status, approved_at
     ) values ($1, 'Dashboard Seller LLC', 'Dashboard Seller', 'active', 'approved', now())
     returning id`,
    [sellerOwnerId],
  );

  const storeResult = await pool.query(
    `insert into stores (seller_id, slug, name, status, default_currency)
     values ($1, $2, 'Dashboard Store', 'active', 'USD')
     returning id`,
    [sellerResult.rows[0].id, `dashboard-store-${label}`],
  );

  return {
    dashboardUserId,
    storeId: storeResult.rows[0].id,
  };
}

/** Verifies both Dashboard-owned tables, indexes, foreign keys, and row-local integrity guards. */
async function verifyModule1Shape(label) {
  for (const tableName of ["dashboard_preferences", "dashboard_saved_filters"]) {
    assertCondition(await tableExists(tableName), `Missing Module 1 table: ${tableName}`);
  }

  for (const indexName of [
    "dashboard_preferences_user_uq",
    "dashboard_preferences_default_store_idx",
    "dashboard_saved_filters_user_created_idx",
  ]) {
    assertCondition(await indexExists(indexName), `Missing Module 1 index: ${indexName}`);
  }

  for (const [tableName, constraintName] of [
    ["dashboard_preferences", "dashboard_preferences_user_id_users_id_fk"],
    ["dashboard_preferences", "dashboard_preferences_default_store_id_stores_id_fk"],
    ["dashboard_preferences", "dashboard_preferences_layout_check"],
    [
      "dashboard_preferences",
      "dashboard_preferences_default_date_range_not_blank_check",
    ],
    ["dashboard_saved_filters", "dashboard_saved_filters_user_id_users_id_fk"],
    ["dashboard_saved_filters", "dashboard_saved_filters_name_not_blank_check"],
    ["dashboard_saved_filters", "dashboard_saved_filters_filter_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `Missing Module 1 constraint: ${constraintName}`,
    );
  }

  const layoutJson = await columnDefinition("dashboard_preferences", "layout_json");
  assertCondition(
    layoutJson?.data_type === "jsonb" && layoutJson?.is_nullable === "NO",
    "Dashboard layout_json must be required JSONB.",
  );

  const defaultDateRange = await columnDefinition(
    "dashboard_preferences",
    "default_date_range",
  );
  assertCondition(
    defaultDateRange?.data_type === "character varying" &&
      defaultDateRange?.character_maximum_length === 40 &&
      defaultDateRange?.is_nullable === "NO",
    "Dashboard default_date_range must be required varchar(40).",
  );

  const filterJson = await columnDefinition("dashboard_saved_filters", "filter_json");
  assertCondition(
    filterJson?.data_type === "jsonb" && filterJson?.is_nullable === "NO",
    "Dashboard saved-filter filter_json must be required JSONB.",
  );

  const { dashboardUserId, storeId } = await createDashboardFixtures(label);

  await pool.query(
    `insert into dashboard_preferences (
       user_id, layout_json, default_date_range, default_store_id
     ) values ($1, '{"widgets":["sales"]}'::jsonb, 'last_30_days', $2)`,
    [dashboardUserId, storeId],
  );
  await pool.query(
    `insert into dashboard_saved_filters (user_id, name, filter_json)
     values ($1, 'My stores', '{"storeIds":[]}'::jsonb)`,
    [dashboardUserId],
  );

  await expectDatabaseRejection(
    `insert into dashboard_preferences (user_id, default_date_range)
     values ($1, 'last_7_days')`,
    [dashboardUserId],
    "only one Dashboard preference row may exist per user",
  );
  await expectDatabaseRejection(
    `update dashboard_preferences set layout_json = '[]'::jsonb where user_id = $1`,
    [dashboardUserId],
    "Dashboard layout_json must remain an object",
  );
  await expectDatabaseRejection(
    `update dashboard_preferences set default_date_range = '   ' where user_id = $1`,
    [dashboardUserId],
    "Dashboard default_date_range cannot be blank",
  );
  await expectDatabaseRejection(
    `insert into dashboard_saved_filters (user_id, name, filter_json)
     values ($1, '   ', '{}'::jsonb)`,
    [dashboardUserId],
    "Dashboard saved-filter name cannot be blank",
  );
  await expectDatabaseRejection(
    `insert into dashboard_saved_filters (user_id, name, filter_json)
     values ($1, 'Invalid JSON shape', '[]'::jsonb)`,
    [dashboardUserId],
    "Dashboard saved-filter filter_json must remain an object",
  );

  await pool.query("delete from stores where id = $1", [storeId]);
  const preferenceAfterStoreDelete = await pool.query(
    `select default_store_id from dashboard_preferences where user_id = $1`,
    [dashboardUserId],
  );
  assertCondition(
    preferenceAfterStoreDelete.rows[0]?.default_store_id === null,
    "Deleting a Store must clear an optional Dashboard default_store_id.",
  );

  await pool.query("delete from users where id = $1", [dashboardUserId]);
  const preferenceCount = await pool.query(
    `select count(*)::int as count from dashboard_preferences where user_id = $1`,
    [dashboardUserId],
  );
  const savedFilterCount = await pool.query(
    `select count(*)::int as count from dashboard_saved_filters where user_id = $1`,
    [dashboardUserId],
  );
  assertCondition(
    preferenceCount.rows[0]?.count === 0 && savedFilterCount.rows[0]?.count === 0,
    "Deleting a user must cascade only that user's Dashboard-owned state.",
  );
}

/** Proves both the supported 0033 -> 0034 upgrade and a clean migration history through Module 1. */
async function main() {
  try {
    const migrations = await migrationSequence();
    assertCondition(
      migrations.at(-1) === module1Migration,
      `Expected ${module1Migration} to be the Module 1 migration ceiling.`,
    );

    const preModule1 = migrations.filter((name) => name !== module1Migration);

    await resetSchema();
    for (const migration of preModule1) await applyMigration(migration);
    assertCondition(
      !(await tableExists("dashboard_preferences")) &&
        !(await tableExists("dashboard_saved_filters")),
      "Dashboard tables must not exist before migration 0034.",
    );
    await applyMigration(module1Migration);
    await verifyModule1Shape("upgrade");

    await resetSchema();
    for (const migration of migrations) await applyMigration(migration);
    await verifyModule1Shape("clean");

    console.log("Module 1 Dashboard migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
