import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preModule14Migrations = [
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
  "0012_search_discovery.sql",
  "0013_search_reindex_error_code.sql",
  "0014_inventory_partial_shipment_accounting.sql",
  "0015_remove_unused_password_reset_tokens.sql",
  "0016_refresh_session_contract_alignment.sql",
  "0017_cart_wishlist.sql",
  "0018_promotions_coupons.sql",
  "0019_shipping_configuration_core.sql",
  "0020_checkout.sql",
  "0021_shipping_configuration_contract.sql",
  "0022_checkout_contract_persistence.sql",
  "0023_orders_persistence.sql",
  "0024_payments_persistence.sql",
  "0025_commissions_marketplace_fees.sql",
  "0026_commissions_contract_integrity.sql",
  "0027_shipping_fulfillment.sql",
];
const module14Migration = "0028_returns_refunds_disputes.sql";

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

/** Applies every released migration that must already exist before Module 14. */
async function applyPreModule14Migrations() {
  for (const migration of preModule14Migrations) await applyMigration(migration);
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
    `select data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies the five Module 14 tables and their critical persistence invariants. */
async function verifyModule14Shape() {
  for (const tableName of [
    "return_requests",
    "return_items",
    "refunds",
    "return_status_history",
    "dispute_notes",
  ]) {
    assertCondition(await tableExists(tableName), `Missing Module 14 table: ${tableName}`);
  }

  assertCondition(
    await constraintExists("return_requests", "return_requests_seller_order_parent_fk"),
    "Return Requests must bind seller_order_id to the same parent order_id.",
  );
  assertCondition(
    await constraintExists("return_items", "return_items_quantity_positive_check"),
    "Return Item quantity must be positive.",
  );
  assertCondition(
    await constraintExists("return_items", "return_items_restock_qty_not_over_quantity_check"),
    "Return Item restock quantity cannot exceed requested quantity.",
  );
  assertCondition(
    await constraintExists("refunds", "refunds_amount_positive_check"),
    "Refund amount must be positive.",
  );
  assertCondition(
    await constraintExists("refunds", "refunds_currency_check"),
    "Refund currency must use normalized ISO-style three-letter codes.",
  );
  assertCondition(
    await indexExists("refunds_idempotency_key_uq"),
    "Refund idempotency key must be uniquely indexed.",
  );
  assertCondition(
    await indexExists("return_items_request_order_item_uq"),
    "One Return Request must not duplicate the same Order Item row.",
  );

  const refundAmount = await columnDefinition("refunds", "amount");
  assertCondition(
    refundAmount?.data_type === "numeric" && refundAmount?.numeric_scale === 4,
    "Refund amount must be PostgreSQL NUMERIC with scale 4.",
  );
  const refundIdempotency = await columnDefinition("refunds", "idempotency_key");
  assertCondition(
    refundIdempotency?.is_nullable === "NO",
    "Refund idempotency_key must be required.",
  );
}

/** Proves Module 14 upgrades the previous supported schema and also works in a clean full-history migration. */
async function main() {
  try {
    await resetSchema();
    await applyPreModule14Migrations();
    assertCondition(
      !(await tableExists("return_requests")),
      "Module 14 tables must not exist before migration 0028.",
    );
    await applyMigration(module14Migration);
    await verifyModule14Shape();

    await resetSchema();
    for (const migration of [...preModule14Migrations, module14Migration]) {
      await applyMigration(migration);
    }
    await verifyModule14Shape();

    console.log("Module 14 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
