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
];
const module7Migration = "0011_inventory_stock.sql";
const partialShipmentMigration = "0014_inventory_partial_shipment_accounting.sql";

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

/** Applies all accepted migrations through Module 6. */
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

/** Returns basic metadata for one database column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies all Module 7 tables and critical stock-integrity guards. */
async function verifyInventorySchema() {
  for (const tableName of ["inventory_items", "stock_movements", "stock_reservations"]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "inventory_items_store_variant_uq",
    "inventory_items_seller_store_idx",
    "inventory_items_variant_idx",
    "inventory_items_reorder_idx",
    "stock_movements_idempotency_key_uq",
    "stock_movements_item_occurred_idx",
    "stock_movements_source_idx",
    "stock_reservations_source_key_uq",
    "stock_reservations_variant_status_expiry_idx",
    "stock_reservations_customer_status_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["inventory_items", "inventory_items_seller_id_sellers_id_fk"],
    ["inventory_items", "inventory_items_store_seller_fk"],
    ["inventory_items", "inventory_items_variant_id_product_variants_id_fk"],
    ["inventory_items", "inventory_items_on_hand_nonnegative_check"],
    ["inventory_items", "inventory_items_reserved_nonnegative_check"],
    ["inventory_items", "inventory_items_reserved_not_over_on_hand_check"],
    ["stock_movements", "stock_movements_inventory_item_id_inventory_items_id_fk"],
    ["stock_movements", "stock_movements_idempotency_key_normalized_check"],
    ["stock_reservations", "stock_reservations_variant_id_product_variants_id_fk"],
    ["stock_reservations", "stock_reservations_customer_user_id_customer_profiles_user_id_fk"],
    ["stock_reservations", "stock_reservations_qty_positive_check"],
    ["stock_reservations", "stock_reservations_status_check"],
    ["stock_reservations", "stock_reservations_consumed_qty_range_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  for (const [tableName, columnName] of [
    ["inventory_items", "on_hand_qty"],
    ["inventory_items", "reserved_qty"],
    ["inventory_items", "reorder_level"],
    ["stock_movements", "quantity_delta"],
    ["stock_reservations", "qty"],
    ["stock_reservations", "consumed_qty"],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(definition?.data_type === "integer", `${tableName}.${columnName} must be INTEGER.`);
  }

  assertCondition(
    await triggerExists("inventory_items_variant_scope_trigger"),
    "Inventory seller/store/variant scope trigger is missing.",
  );
  assertCondition(
    await triggerExists("stock_movements_append_only_trigger"),
    "Append-only stock movement trigger is missing.",
  );

  const consumedQuantity = await columnDefinition("stock_reservations", "consumed_qty");
  assertCondition(consumedQuantity?.is_nullable === "NO", "stock_reservations.consumed_qty must be NOT NULL.");
  assertCondition(
    String(consumedQuantity?.column_default ?? "").includes("0"),
    "stock_reservations.consumed_qty must default to zero.",
  );
}

/** Verifies a clean database can reach Module 7 from the complete migration history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await applyMigration(module7Migration);
  await applyMigration(partialShipmentMigration);
  await verifyInventorySchema();
}

/** Verifies the accepted Module 6 schema upgrades to Module 7 without changing Product rows. */
async function verifyModule6UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();

  const before = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores`,
  );

  await applyMigration(module7Migration);
  await applyMigration(partialShipmentMigration);
  await verifyInventorySchema();

  const after = await pool.query(
    `select
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 7 migration changed existing seller/store/Product data.",
  );
}

/** Verifies the partial-shipment migration preserves live reservations and backfills already-consumed reservations. */
async function verifyPartialShipmentUpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await applyMigration(module7Migration);

  const fixture = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('inventory-migration-seller@example.com', 'migration-password-hash', 'Migration Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('inventory-migration-customer@example.com', 'migration-password-hash', 'Migration Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Migration Customer', 'active' from customer_user
       returning user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Migration Seller', 'Migration Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, 'migration-store', 'Migration Store', 'active', 'USD' from seller_row
       returning id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ('migration-category', 'Migration Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (seller_id, store_id, category_id, slug, name, description, status, publication_status, created_by)
       select seller_row.id, store_row.id, category_row.id,
              'migration-product', 'Migration Product', 'Migration Product',
              'active', 'draft', seller_user.id
       from seller_user, seller_row, store_row, category_row
       returning id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, 'MIGRATION-SKU', 'Migration Variant', 10.00, 'USD', 'active' from product_row
       returning id
     )
     select variant_row.id as variant_id, customer_profile.user_id as customer_user_id
       from variant_row, customer_profile`,
  );
  const variantId = fixture.rows[0]?.variant_id;
  const customerUserId = fixture.rows[0]?.customer_user_id;
  assertCondition(Boolean(variantId), "Partial-shipment migration fixture could not create a Product variant.");
  assertCondition(Boolean(customerUserId), "Partial-shipment migration fixture could not create a Customer profile.");

  await pool.query(
    `insert into stock_reservations (variant_id, customer_user_id, qty, status, expires_at, source_key)
     values
       ($1, $2, 5, 'consumed', now() + interval '1 hour', 'module7-migration-consumed'),
       ($1, $2, 7, 'committed', now() + interval '1 hour', 'module7-migration-committed')`,
    [variantId, customerUserId],
  );

  await applyMigration(partialShipmentMigration);
  await verifyInventorySchema();

  const rows = await pool.query(
    `select source_key, qty, consumed_qty from stock_reservations order by source_key`,
  );
  const bySource = new Map(rows.rows.map((row) => [row.source_key, row]));
  assertCondition(
    bySource.get('module7-migration-consumed')?.consumed_qty === 5,
    "Already-consumed reservations must backfill consumed_qty to qty.",
  );
  assertCondition(
    bySource.get('module7-migration-committed')?.consumed_qty === 0,
    "Live committed reservations must keep zero consumed quantity after upgrade.",
  );
}

/** Runs clean-schema and supported upgrade verification for the permanent Module 7 migration history. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyModule6UpgradePath();
    await verifyPartialShipmentUpgradePath();
    console.log("Module 7 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
