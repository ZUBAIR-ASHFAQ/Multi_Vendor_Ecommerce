import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preModule16Migrations = [
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
];
const module16BaselineMigration = "0025_commissions_marketplace_fees.sql";
const module16RemediationMigration = "0026_commissions_contract_integrity.sql";

/** Resets the disposable public schema before one destructive migration scenario. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed append-only migration exactly as stored in the repository. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

/** Applies the complete released database history that existed before Module 16 was introduced. */
async function applyPreModule16Migrations() {
  for (const migration of preModule16Migrations) await applyMigration(migration);
}

/** Throws one focused verification error when a database condition is false. */
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

/** Runs a statement expected to fail and confirms PostgreSQL rejected it with the requested code. */
async function expectDatabaseError(query, params, expectedCode, message) {
  let rejected = false;
  try {
    await pool.query(query, params);
  } catch (error) {
    rejected = error?.code === expectedCode;
  }
  assertCondition(rejected, message);
}

/** Creates one complete Seller/Order Item fixture without depending on future Commission service code. */
async function createOrderItemFixture(suffix) {
  const orderId = randomUUID();
  const sellerOrderId = randomUUID();
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($1, 'migration-password-hash', 'Module 16 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($2, 'migration-password-hash', 'Module 16 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 16 Customer', 'active' from customer_user
       returning user_id
     ), customer_address as (
       insert into customer_addresses (
         customer_user_id, label, recipient_name, phone, line1, city, region,
         country_code, is_default_shipping, is_default_billing, status
       )
       select user_id, 'Home', 'Module 16 Customer', '+1 555 0160', '16 Commission Way',
              'Test City', 'Test Region', 'US', true, true, 'active'
         from customer_profile
       returning id, customer_user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 16 Seller', 'Module 16 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, $3, 'Module 16 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), shipping_method as (
       insert into shipping_methods (
         owner_type, seller_id, code, name, pricing_type, base_rate, currency, status
       )
       select 'seller', seller_row.id, $4, 'Module 16 Standard', 'flat', 5.0000, 'USD', 'active'
         from seller_row
       returning id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ($5, 'Module 16 Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (
         seller_id, store_id, category_id, slug, name, description,
         status, publication_status, created_by
       )
       select seller_row.id, store_row.id, category_row.id,
              $6, 'Module 16 Product', 'Module 16 Product',
              'active', 'published', seller_user.id
         from seller_user, seller_row, store_row, category_row
       returning id, seller_id, store_id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, $7, 'Module 16 Variant', 100.0000, 'USD', 'active' from product_row
       returning id
     ), inventory_row as (
       insert into inventory_items (seller_id, store_id, variant_id, on_hand_qty, reserved_qty)
       select product_row.seller_id, product_row.store_id, variant_row.id, 10, 1
         from product_row, variant_row
       returning id
     ), quote_row as (
       insert into checkout_quotes (
         customer_user_id, shipping_address_id, billing_address_id, currency,
         subtotal, discount_total, tax_total, shipping_total, grand_total,
         expires_at, state_hash
       )
       select customer_profile.user_id, customer_address.id, customer_address.id, 'USD',
              100.0000, 10.0000, 9.0000, 5.0000, 104.0000,
              now() + interval '30 minutes', repeat('a', 64)
         from customer_profile, customer_address
       returning id, customer_user_id
     ), quote_line as (
       insert into checkout_quote_lines (
         quote_id, variant_id, seller_id, store_id, qty, unit_price, discount, tax, line_total
       )
       select quote_row.id, variant_row.id, seller_row.id, store_row.id,
              1, 100.0000, 10.0000, 9.0000, 99.0000
         from quote_row, variant_row, seller_row, store_row
       returning quote_id
     ), quote_shipping as (
       insert into checkout_quote_shipping_selections (
         quote_id, seller_id, store_id, shipping_method_id,
         shipping_method_code_snapshot, shipping_method_name_snapshot, amount, currency
       )
       select quote_row.id, seller_row.id, store_row.id, shipping_method.id,
              $4, 'Module 16 Standard', 5.0000, 'USD'
         from quote_row, seller_row, store_row, shipping_method
       returning quote_id
     ), attempt_row as (
       insert into checkout_attempts (
         quote_id, customer_user_id, status, idempotency_key, expires_at
       )
       select quote_row.id, quote_row.customer_user_id, 'confirmed', $8, now() + interval '30 minutes'
         from quote_row
       returning id, customer_user_id
     ), reservation_row as (
       insert into stock_reservations (
         variant_id, customer_user_id, order_attempt_id, qty, consumed_qty,
         released_qty, status, expires_at, source_key
       )
       select variant_row.id, attempt_row.customer_user_id, attempt_row.id, 1, 0,
              0, 'reserved', now() + interval '30 minutes', $9
         from variant_row, attempt_row
       returning id
     ), order_row as (
       insert into orders (
         id, order_no, checkout_attempt_id, customer_user_id, currency,
         subtotal, discount_total, tax_total, shipping_total, grand_total
       )
       select $10, $11, attempt_row.id, attempt_row.customer_user_id, 'USD',
              100.0000, 10.0000, 9.0000, 5.0000, 104.0000
         from attempt_row
       returning id, customer_user_id
     ), seller_order_row as (
       insert into seller_orders (
         id, order_id, seller_id, store_id, seller_order_no,
         subtotal, discount_total, tax_total, shipping_total, grand_total,
         shipping_method_id, shipping_method_code_snapshot, shipping_method_name_snapshot
       )
       select $12, order_row.id, seller_row.id, store_row.id, $13,
              100.0000, 10.0000, 9.0000, 5.0000, 104.0000,
              shipping_method.id, $4, 'Module 16 Standard'
         from order_row, seller_row, store_row, shipping_method
       returning id, order_id, seller_id
     ), order_item_row as (
       insert into order_items (
         order_id, seller_order_id, product_id, variant_id, inventory_reservation_id,
         sku_snapshot, name_snapshot, variant_title_snapshot, qty,
         unit_price, discount_allocated, tax_allocated, line_total
       )
       select order_row.id, seller_order_row.id, product_row.id, variant_row.id, reservation_row.id,
              $7, 'Module 16 Product', 'Module 16 Variant', 1,
              100.0000, 10.0000, 9.0000, 99.0000
         from order_row, seller_order_row, product_row, variant_row, reservation_row
       returning id
     ), checkout_link as (
       update checkout_attempts
          set order_id = order_row.id
         from order_row
        where checkout_attempts.id = (select id from attempt_row)
       returning checkout_attempts.id
     )
     select seller_row.id as seller_id,
            seller_order_row.id as seller_order_id,
            order_item_row.id as order_item_id,
            order_row.id as order_id
       from seller_row, seller_order_row, order_item_row, order_row`,
    [
      `module16-migration-seller-${suffix}@example.com`,
      `module16-migration-customer-${suffix}@example.com`,
      `module16-migration-store-${suffix}`,
      `MODULE16-${suffix.toUpperCase()}-SHIP`,
      `module16-migration-category-${suffix}`,
      `module16-migration-product-${suffix}`,
      `MODULE16-${suffix.toUpperCase()}-SKU`,
      `module16-attempt-${suffix}`,
      `module16-reservation-${suffix}`,
      orderId,
      `ORD-${orderId.replaceAll("-", "").toUpperCase()}`,
      sellerOrderId,
      `SOR-${sellerOrderId.replaceAll("-", "").toUpperCase()}`,
    ],
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.order_item_id), "Module 16 fixture could not create an Order Item.");
  return fixture;
}

/** Verifies the three approved Commission tables, exact-number columns, indexes, and foreign keys. */
async function verifyModule16Schema() {
  for (const tableName of [
    "commission_rules",
    "commission_entries",
    "commission_rule_snapshots",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const [tableName, columnName, precision, scale] of [
    ["commission_rules", "rate_percent", 9, 6],
    ["commission_rules", "fixed_fee", 18, 4],
    ["commission_rule_snapshots", "rate_percent", 9, 6],
    ["commission_rule_snapshots", "fixed_fee", 18, 4],
    ["commission_entries", "gross_amount", 18, 4],
    ["commission_entries", "commission_amount", 18, 4],
    ["commission_entries", "seller_net_amount", 18, 4],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(
      definition?.numeric_precision === precision && definition?.numeric_scale === scale,
      `${tableName}.${columnName} must be NUMERIC(${precision},${scale}).`,
    );
  }

  for (const indexName of [
    "commission_rules_resolution_idx",
    "commission_rules_status_start_idx",
    "commission_rule_snapshots_order_item_uq",
    "commission_rule_snapshots_rule_idx",
    "commission_entries_source_key_uq",
    "commission_entries_seller_occurred_idx",
    "commission_entries_seller_order_occurred_idx",
    "commission_entries_order_item_occurred_idx",
    "commission_entries_type_occurred_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} index is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["commission_rules", "commission_rules_scope_type_check"],
    ["commission_rules", "commission_rules_scope_shape_check"],
    ["commission_rules", "commission_rules_rate_percent_check"],
    ["commission_rules", "commission_rules_date_range_check"],
    ["commission_rules", "commission_rules_status_check"],
    ["commission_rule_snapshots", "commission_rule_snapshots_order_item_id_order_items_id_fk"],
    ["commission_rule_snapshots", "commission_rule_snapshots_rule_id_commission_rules_id_fk"],
    ["commission_entries", "commission_entries_seller_id_sellers_id_fk"],
    ["commission_entries", "commission_entries_seller_order_id_seller_orders_id_fk"],
    ["commission_entries", "commission_entries_order_item_id_order_items_id_fk"],
    ["commission_entries", "commission_entries_type_check"],
    ["commission_entries", "commission_entries_currency_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${constraintName} constraint is missing.`,
    );
  }
}

/** Persists valid Commission rows and proves row-local safety without inventing later business logic. */
async function verifyCommissionPersistence(fixture) {
  const rule = await pool.query(
    `insert into commission_rules (
       priority, scope_type, scope_id, rate_percent, fixed_fee,
       funding_rules_json, start_at, status
     ) values (100, 'seller', $1, 10.000000, 1.5000, '{"mode":"snapshot-only"}'::jsonb, now(), 'active')
     returning id`,
    [fixture.seller_id],
  );
  const ruleId = rule.rows[0]?.id;
  assertCondition(Boolean(ruleId), "Valid Commission rule could not be persisted.");

  await pool.query(
    `insert into commission_rule_snapshots (
       order_item_id, rule_id, rate_percent, fixed_fee, basis_json
     ) values ($1, $2, 10.000000, 1.5000, '{"gross":"90.0000"}'::jsonb)`,
    [fixture.order_item_id, ruleId],
  );

  await pool.query(
    `insert into commission_entries (
       seller_id, seller_order_id, order_item_id, type,
       gross_amount, commission_amount, seller_net_amount,
       currency, source_key, occurred_at
     ) values ($1, $2, $3, 'sale', 90.0000, 10.5000, 79.5000, 'USD', $4, now())`,
    [fixture.seller_id, fixture.seller_order_id, fixture.order_item_id, `module16:sale:${fixture.order_item_id}`],
  );

  await pool.query(
    `insert into commission_entries (
       seller_id, seller_order_id, order_item_id, type,
       gross_amount, commission_amount, seller_net_amount,
       currency, source_key, occurred_at
     ) values ($1, $2, $3, 'refund', -30.0000, -3.5000, -26.5000, 'USD', $4, now())`,
    [fixture.seller_id, fixture.seller_order_id, fixture.order_item_id, `module16:refund:${fixture.order_item_id}`],
  );

  await expectDatabaseError(
    `insert into commission_rule_snapshots (
       order_item_id, rule_id, rate_percent, fixed_fee, basis_json
     ) values ($1, $2, 10.000000, 1.5000, '{}'::jsonb)`,
    [fixture.order_item_id, ruleId],
    "23505",
    "One Order Item must not receive two Commission snapshots.",
  );

  await expectDatabaseError(
    `insert into commission_entries (
       seller_id, seller_order_id, order_item_id, type,
       gross_amount, commission_amount, seller_net_amount,
       currency, source_key, occurred_at
     ) values ($1, $2, $3, 'adjustment', 0, 0, 0, 'USD', $4, now())`,
    [fixture.seller_id, fixture.seller_order_id, fixture.order_item_id, `module16:sale:${fixture.order_item_id}`],
    "23505",
    "Commission source keys must be unique for replay safety.",
  );

  await expectDatabaseError(
    `insert into commission_rules (priority, scope_type, scope_id, rate_percent, start_at, status)
     values (1, 'default', $1, 10.000000, now(), 'active')`,
    [fixture.seller_id],
    "23514",
    "Default Commission rule scope must not carry scope_id.",
  );

  await expectDatabaseError(
    `insert into commission_rules (priority, scope_type, scope_id, rate_percent, start_at, status)
     values (1, 'seller', $1, 100.000001, now(), 'active')`,
    [fixture.seller_id],
    "23514",
    "Commission percentage must not exceed 100.",
  );

  await expectDatabaseError(
    `insert into commission_rules (priority, scope_type, scope_id, rate_percent, fixed_fee, start_at, status)
     values (1, 'seller', $1, 10.000000, -0.0001, now(), 'active')`,
    [fixture.seller_id],
    "23514",
    "Commission fixed fee must not be negative.",
  );

  await pool.query(
    `insert into commission_rules (priority, scope_type, rate_percent, start_at, status)
     values (2, 'default', 0.000000, now(), 'inactive')`,
  );

  await expectDatabaseError(
    `insert into commission_rules (priority, scope_type, rate_percent, start_at, status)
     values (3, 'default', 0.000000, now(), 'draft')`,
    [],
    "23514",
    "Commission rule status must be active or inactive.",
  );

  await expectDatabaseError(
    `insert into commission_entries (
       seller_id, seller_order_id, order_item_id, type,
       gross_amount, commission_amount, seller_net_amount,
       currency, source_key, occurred_at
     ) values ($1, $2, $3, 'sale', 1, 0, 1, 'usd', 'module16:bad-currency', now())`,
    [fixture.seller_id, fixture.seller_order_id, fixture.order_item_id],
    "23514",
    "Commission currency must be normalized uppercase ISO-like code.",
  );
}

/** Verifies a clean database applies both the original Module 16 migration and this remediation. */
async function verifyCleanMigration() {
  await resetSchema();
  await applyPreModule16Migrations();
  await applyMigration(module16BaselineMigration);
  await applyMigration(module16RemediationMigration);
  await verifyModule16Schema();
  const fixture = await createOrderItemFixture("clean");
  await verifyCommissionPersistence(fixture);
}

/** Creates one valid pre-remediation Commission row whose identity must survive the new constraint migration. */
async function createPreRemediationRule() {
  const result = await pool.query(
    `insert into commission_rules (
       priority, scope_type, rate_percent, start_at, status
     ) values (50, 'default', 7.500000, now(), 'active')
     returning id, priority, status`,
  );
  return result.rows[0];
}

/** Verifies an existing 0025 database upgrades to 0026 without rewriting valid Commission or Payment data. */
async function verifySupportedUpgrade() {
  await resetSchema();
  await applyPreModule16Migrations();
  await applyMigration(module16BaselineMigration);

  const fixture = await createOrderItemFixture("upgrade");
  const existingRule = await createPreRemediationRule();

  await pool.query(
    `insert into payments (
       order_id, provider, provider_payment_id, currency,
       amount_authorized, amount_captured, amount_refunded, status, idempotency_key
     ) values ($1, 'stripe', 'pi_module16_upgrade', 'USD', 104.0000, 104.0000, 0.0000, 'captured', repeat('e', 64))`,
    [fixture.order_id],
  );

  await applyMigration(module16RemediationMigration);
  await verifyModule16Schema();

  const preservedRule = await pool.query(
    `select priority, status from commission_rules where id = $1`,
    [existingRule.id],
  );
  assertCondition(
    preservedRule.rows[0]?.priority === 50 && preservedRule.rows[0]?.status === "active",
    "Module 16 remediation changed an existing valid Commission rule.",
  );

  const payment = await pool.query(
    `select amount_captured, status from payments where order_id = $1`,
    [fixture.order_id],
  );
  assertCondition(
    payment.rows[0]?.amount_captured === "104.0000",
    "Module 16 remediation changed captured Payment amount.",
  );
  assertCondition(
    payment.rows[0]?.status === "captured",
    "Module 16 remediation changed Payment status.",
  );

  const postUpgradeFixture = await createOrderItemFixture("upgrade-after");
  await verifyCommissionPersistence(postUpgradeFixture);
}

/** Verifies legacy unsupported statuses block the migration instead of being silently converted. */
async function verifyUnsupportedStatusUpgradeFails() {
  await resetSchema();
  await applyPreModule16Migrations();
  await applyMigration(module16BaselineMigration);

  await pool.query(
    `insert into commission_rules (priority, scope_type, rate_percent, start_at, status)
     values (10, 'default', 5.000000, now(), 'draft')`,
  );

  let rejected = false;
  try {
    await applyMigration(module16RemediationMigration);
  } catch (error) {
    rejected = error?.code === "23514";
  }
  assertCondition(
    rejected,
    "Module 16 remediation must fail closed when legacy Commission rules use unsupported statuses.",
  );
}

/** Runs the clean, supported-upgrade, and unsafe-legacy migration scenarios and closes the pool. */
async function main() {
  try {
    await verifyCleanMigration();
    await verifySupportedUpgrade();
    await verifyUnsupportedStatusUpgradeFails();
    console.log(
      "Module 16 remediation Pass 1 migration verification passed for clean, supported-upgrade, and unsafe-legacy status scenarios.",
    );
  } finally {
    await pool.end();
  }
}

await main();
