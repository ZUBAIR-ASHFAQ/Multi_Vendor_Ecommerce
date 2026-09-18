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
];
const module6Migrations = [
  "0009_product_management.sql",
  "0010_product_management_integrity.sql",
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

/** Applies all migrations through the supported Module 5 schema. */
async function applyPrerequisiteMigrations() {
  for (const migration of prerequisiteMigrations) await applyMigration(migration);
}

/** Fails with one focused database verification message. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
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

/** Returns whether one named non-internal trigger exists. */
async function triggerExists(triggerName) {
  const result = await pool.query(
    `select 1
       from pg_trigger
      where tgname = $1
        and not tgisinternal`,
    [triggerName],
  );
  return result.rowCount === 1;
}

/** Returns numeric precision/scale and basic column metadata for one column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, numeric_precision, numeric_scale, character_maximum_length
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies the five required Product Management tables and critical persistence guards. */
async function verifyProductSchema() {
  for (const tableName of [
    "products",
    "product_variants",
    "product_attribute_values",
    "product_media",
    "product_price_history",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "products_slug_uq",
    "products_seller_store_status_idx",
    "products_public_catalog_idx",
    "stores_id_seller_uq",
    "product_variants_product_sku_uq",
    "product_variants_id_product_uq",
    "product_variants_sku_idx",
    "attribute_values_id_attribute_uq",
    "product_attribute_values_product_attribute_uq",
    "product_attribute_values_variant_attribute_uq",
    "product_media_product_status_sort_idx",
    "product_price_history_variant_changed_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  assertCondition(
    !(await indexExists("products_store_slug_uq")),
    "Obsolete store-scoped product slug index must be removed.",
  );

  for (const [tableName, constraintName] of [
    ["products", "products_seller_id_sellers_id_fk"],
    ["products", "products_store_seller_fk"],
    ["products", "products_category_id_categories_id_fk"],
    ["products", "products_brand_id_brands_id_fk"],
    ["product_attribute_values", "product_attribute_values_variant_product_fk"],
    ["product_attribute_values", "product_attribute_values_value_attribute_fk"],
    ["product_media", "product_media_variant_product_fk"],
    ["product_price_history", "product_price_history_variant_id_product_variants_id_fk"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  for (const [tableName, columnName, precision, scale] of [
    ["product_variants", "price", 18, 2],
    ["product_variants", "compare_at_price", 18, 2],
    ["product_price_history", "old_price", 18, 2],
    ["product_price_history", "new_price", 18, 2],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(definition?.data_type === "numeric", `${tableName}.${columnName} must be NUMERIC.`);
    assertCondition(Number(definition.numeric_precision) === precision, `${tableName}.${columnName} precision mismatch.`);
    assertCondition(Number(definition.numeric_scale) === scale, `${tableName}.${columnName} scale mismatch.`);
  }

  assertCondition(
    await triggerExists("product_price_history_append_only_trigger"),
    "Append-only product price-history trigger is missing.",
  );
  assertCondition(
    await triggerExists("product_variants_seller_store_sku_trigger"),
    "Seller/store SKU uniqueness trigger is missing.",
  );
}

/** Verifies a clean database can reach Module 6 from the complete migration history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  for (const migration of module6Migrations) await applyMigration(migration);
  await verifyProductSchema();
}

/** Verifies the supported Module 5 schema upgrades without losing prerequisite catalog/store data. */
async function verifyModule5UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();

  const before = await pool.query(
    `select
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores,
       (select count(*) from categories) as categories`,
  );

  for (const migration of module6Migrations) await applyMigration(migration);
  await verifyProductSchema();

  const after = await pool.query(
    `select
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores,
       (select count(*) from categories) as categories`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 6 migration changed prerequisite seller/store/catalog data.",
  );
}

/** Verifies the original 0009 Product schema upgrades through the Pass 1 integrity patch. */
async function verifyModule6UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await applyMigration("0009_product_management.sql");

  const before = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants`,
  );

  await applyMigration("0010_product_management_integrity.sql");
  await verifyProductSchema();

  const after = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 6 integrity migration changed existing Product/variant row counts.",
  );
}

/** Runs clean-schema and supported-upgrade migration verification. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyModule5UpgradePath();
    await verifyModule6UpgradePath();
    console.log("Module 6 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
