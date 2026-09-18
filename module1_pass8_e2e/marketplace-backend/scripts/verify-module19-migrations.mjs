import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const prerequisiteMigrations = [
  "0000_foundation.sql",
  "0001_administration_auth_rbac.sql",
  "0002_module2_remediation_persistence.sql",
  "0003_module2_role_assignment_identity.sql",
  "0004_documents_audit_core.sql",
  "0005_documents_audit_integrity.sql",
  "0006_customer_management.sql",
  "0007_seller_store_management.sql",
  "0008_catalog_taxonomy.sql",
  "0009_product_management.sql",
  "0010_product_management_integrity.sql",
  "0011_inventory_stock.sql",
];
const module19Migrations = [
  "0012_search_discovery.sql",
  "0013_search_reindex_error_code.sql",
];

/** Resets the disposable public schema used by destructive migration verification. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed SQL migration exactly as stored in append-only history. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

/** Applies all accepted migrations through Module 7. */
async function applyPrerequisiteMigrations() {
  for (const migration of prerequisiteMigrations) await applyMigration(migration);
}

/** Fails with one focused database verification message. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one PostgreSQL extension is installed. */
async function extensionExists(extensionName) {
  const result = await pool.query("select 1 from pg_extension where extname = $1", [
    extensionName,
  ]);
  return result.rowCount === 1;
}

/** Returns whether one public table exists. */
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

/** Returns the SQL definition for one public index. */
async function indexDefinition(indexName) {
  const result = await pool.query(
    `select indexdef from pg_indexes where schemaname = 'public' and indexname = $1`,
    [indexName],
  );
  return result.rows[0]?.indexdef ?? "";
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

/** Returns basic metadata for one database column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, column_default, character_maximum_length
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies the Module 19 read-model tables, Search indexes, and local integrity guards. */
async function verifySearchSchema() {
  assertCondition(await extensionExists("pg_trgm"), "pg_trgm extension is missing.");

  for (const tableName of [
    "product_search_documents",
    "search_synonyms",
    "search_reindex_runs",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "product_search_documents_fts_idx",
    "product_search_documents_trgm_idx",
    "product_search_documents_category_idx",
    "product_search_documents_brand_idx",
    "product_search_documents_price_idx",
    "product_search_documents_rating_idx",
    "product_search_documents_in_stock_idx",
    "product_search_documents_attributes_idx",
    "product_search_documents_updated_idx",
    "search_synonyms_term_uq",
    "search_synonyms_status_term_idx",
    "search_reindex_runs_active_scope_uq",
    "search_reindex_runs_status_requested_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  const ftsIndex = await indexDefinition("product_search_documents_fts_idx");
  assertCondition(
    ftsIndex.includes("to_tsvector('simple'::regconfig, searchable_text)"),
    "Product Search FTS index must use to_tsvector(simple, searchable_text).",
  );

  const trigramIndex = await indexDefinition("product_search_documents_trgm_idx");
  assertCondition(
    trigramIndex.includes("gin_trgm_ops"),
    "Product Search trigram index must use gin_trgm_ops.",
  );

  for (const [tableName, constraintName] of [
    ["product_search_documents", "product_search_documents_product_id_products_id_fk"],
    ["product_search_documents", "product_search_documents_category_id_categories_id_fk"],
    ["product_search_documents", "product_search_documents_brand_id_brands_id_fk"],
    ["product_search_documents", "product_search_documents_price_range_check"],
    ["product_search_documents", "product_search_documents_rating_avg_check"],
    ["product_search_documents", "product_search_documents_attributes_object_check"],
    ["search_synonyms", "search_synonyms_term_normalized_check"],
    ["search_synonyms", "search_synonyms_values_array_check"],
    ["search_reindex_runs", "search_reindex_runs_status_check"],
    ["search_reindex_runs", "search_reindex_runs_state_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  for (const [tableName, columnName, dataType] of [
    ["product_search_documents", "min_price", "numeric"],
    ["product_search_documents", "max_price", "numeric"],
    ["product_search_documents", "rating_avg", "numeric"],
    ["product_search_documents", "rating_count", "integer"],
    ["product_search_documents", "in_stock", "boolean"],
    ["product_search_documents", "filterable_attributes", "jsonb"],
    ["search_synonyms", "synonyms", "jsonb"],
    ["search_reindex_runs", "error_code", "character varying"],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(
      definition?.data_type === dataType,
      `${tableName}.${columnName} must be ${dataType.toUpperCase()}.`,
    );
  }
  const reindexErrorCode = await columnDefinition("search_reindex_runs", "error_code");
  assertCondition(
    reindexErrorCode?.character_maximum_length === 120,
    "search_reindex_runs.error_code must be bounded to VARCHAR(120).",
  );

  const removedErrorMessage = await columnDefinition("search_reindex_runs", "error_message");
  assertCondition(
    removedErrorMessage === null,
    "search_reindex_runs.error_message must be replaced by the required error_code column.",
  );

}

/** Proves the database prevents two active full-catalog reindex runs. */
async function verifySingleActiveReindexGuard() {
  const first = await pool.query(
    `insert into search_reindex_runs default values returning id, requested_at`,
  );

  let duplicateRejected = false;
  try {
    await pool.query(`insert into search_reindex_runs default values`);
  } catch (error) {
    duplicateRejected = error?.code === "23505";
  }
  assertCondition(duplicateRejected, "A second active Search reindex run was not rejected.");

  await pool.query(
    `update search_reindex_runs
        set status = 'completed',
            started_at = requested_at,
            completed_at = requested_at,
            updated_at = now()
      where id = $1`,
    [first.rows[0].id],
  );

  await pool.query(`insert into search_reindex_runs default values`);
}

/** Verifies a clean database can reach Module 19 from the complete migration history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  for (const migration of module19Migrations) await applyMigration(migration);
  await verifySearchSchema();
  await verifySingleActiveReindexGuard();
}

/** Verifies the accepted Module 7 schema upgrades without mutating authoritative source rows. */
async function verifyModule7UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();

  const before = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from inventory_items) as inventory_items,
       (select count(*) from stock_movements) as stock_movements,
       (select count(*) from stock_reservations) as stock_reservations`,
  );

  for (const migration of module19Migrations) await applyMigration(migration);
  await verifySearchSchema();

  const after = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from inventory_items) as inventory_items,
       (select count(*) from stock_movements) as stock_movements,
       (select count(*) from stock_reservations) as stock_reservations`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 19 migration changed authoritative Product or Inventory data.",
  );
}

/** Runs clean-schema and supported Module 7 -> Module 19 upgrade verification. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyModule7UpgradePath();
    console.log("Module 19 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
