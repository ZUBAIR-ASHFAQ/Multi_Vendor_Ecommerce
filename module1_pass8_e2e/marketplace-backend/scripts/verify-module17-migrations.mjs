import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preModule17Migrations = [
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
  "0028_returns_refunds_disputes.sql",
];
const module17Migration = "0029_seller_wallet_payouts.sql";

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

/** Applies every released migration that must already exist before Module 17. */
async function applyPreModule17Migrations() {
  for (const migration of preModule17Migrations) await applyMigration(migration);
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

/** Verifies the five Module 17 tables and their critical persistence invariants. */
async function verifyModule17Shape() {
  for (const tableName of [
    "seller_wallets",
    "seller_wallet_entries",
    "payout_accounts",
    "payouts",
    "payout_allocations",
  ]) {
    assertCondition(await tableExists(tableName), `Missing Module 17 table: ${tableName}`);
  }

  assertCondition(
    await constraintExists("seller_wallets", "seller_wallets_pk"),
    "Seller Wallet must be keyed by seller and currency.",
  );
  assertCondition(
    await constraintExists("seller_wallet_entries", "seller_wallet_entries_wallet_fk"),
    "Wallet entries must belong to one persisted seller/currency Wallet.",
  );
  assertCondition(
    await indexExists("seller_wallet_entries_source_key_uq"),
    "Wallet entry source_key must be uniquely indexed.",
  );
  assertCondition(
    await constraintExists("payouts", "payouts_account_seller_fk"),
    "Payout account ownership must match the Payout seller.",
  );
  assertCondition(
    await constraintExists("payouts", "payouts_wallet_fk"),
    "Payout seller/currency must reference a persisted Wallet.",
  );
  assertCondition(
    await constraintExists("payouts", "payouts_amount_positive_check"),
    "Payout amount must be positive.",
  );
  assertCondition(
    await constraintExists("payout_allocations", "payout_allocations_pk"),
    "A Payout must not allocate the same Wallet entry twice.",
  );
  assertCondition(
    await constraintExists("payout_allocations", "payout_allocations_amount_positive_check"),
    "Payout allocation amount must be positive.",
  );

  for (const [tableName, columnName] of [
    ["seller_wallets", "pending_balance"],
    ["seller_wallets", "available_balance"],
    ["seller_wallets", "held_balance"],
    ["seller_wallets", "negative_balance"],
    ["seller_wallet_entries", "amount"],
    ["payouts", "amount"],
    ["payout_allocations", "amount"],
  ]) {
    const column = await columnDefinition(tableName, columnName);
    assertCondition(
      column?.data_type === "numeric" && column?.numeric_scale === 4,
      `${tableName}.${columnName} must be PostgreSQL NUMERIC with scale 4.`,
    );
  }

  const walletEntryCurrency = await columnDefinition("seller_wallet_entries", "currency");
  assertCondition(
    walletEntryCurrency?.is_nullable === "NO" && walletEntryCurrency?.character_maximum_length === 3,
    "Wallet entries must persist the exact three-letter Wallet currency.",
  );
}

/** Proves Module 17 upgrades the released schema and also works from a clean full migration history. */
async function main() {
  try {
    await resetSchema();
    await applyPreModule17Migrations();
    assertCondition(
      !(await tableExists("seller_wallets")),
      "Module 17 tables must not exist before migration 0029.",
    );
    await applyMigration(module17Migration);
    await verifyModule17Shape();

    await resetSchema();
    for (const migration of [...preModule17Migrations, module17Migration]) {
      await applyMigration(migration);
    }
    await verifyModule17Shape();

    console.log("Module 17 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
