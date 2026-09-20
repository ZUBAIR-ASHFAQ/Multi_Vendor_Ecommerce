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
  "0012_search_discovery.sql",
  "0013_search_reindex_error_code.sql",
  "0014_inventory_partial_shipment_accounting.sql",
  "0015_remove_unused_password_reset_tokens.sql",
  "0016_refresh_session_contract_alignment.sql",
  "0017_cart_wishlist.sql",
];
const module9Migration = "0018_promotions_coupons.sql";

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

/** Applies every accepted migration that exists before Module 9. */
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

/** Returns numeric and nullability metadata for one public database column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, numeric_precision, numeric_scale
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Runs an INSERT expected to fail and verifies PostgreSQL rejected it for the requested reason. */
async function expectDatabaseError(query, params, expectedCode, message) {
  let rejected = false;
  try {
    await pool.query(query, params);
  } catch (error) {
    rejected = error?.code === expectedCode;
  }
  assertCondition(rejected, message);
}

/** Creates Seller, Customer, Catalog, and Product rows required by Module 9 migration checks. */
async function createPrerequisiteFixture() {
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('module9-migration-seller@example.com', 'migration-password-hash', 'Module 9 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('module9-migration-customer@example.com', 'migration-password-hash', 'Module 9 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 9 Customer', 'active' from customer_user
       returning user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 9 Seller', 'Module 9 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, 'module9-migration-store', 'Module 9 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ('module9-migration-category', 'Module 9 Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (seller_id, store_id, category_id, slug, name, description, status, publication_status, created_by)
       select seller_row.id, store_row.id, category_row.id,
              'module9-migration-product', 'Module 9 Product', 'Module 9 Product',
              'active', 'draft', seller_user.id
       from seller_user, seller_row, store_row, category_row
       returning id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, 'MODULE9-SKU', 'Module 9 Variant', 100.00, 'USD', 'active' from product_row
       returning id
     )
     select customer_profile.user_id as customer_user_id,
            seller_row.id as seller_id,
            store_row.id as store_id,
            category_row.id as category_id,
            product_row.id as product_id,
            variant_row.id as variant_id
       from customer_profile, seller_row, store_row, category_row, product_row, variant_row`,
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.customer_user_id), "Module 9 fixture could not create a Customer profile.");
  assertCondition(Boolean(fixture?.seller_id), "Module 9 fixture could not create a Seller.");
  assertCondition(Boolean(fixture?.product_id), "Module 9 fixture could not create a Product.");
  return fixture;
}

/** Verifies all Module 9 tables, indexes, foreign keys, and local checks exist. */
async function verifyPromotionsSchema() {
  for (const tableName of [
    "promotions",
    "promotion_scopes",
    "coupons",
    "coupon_redemptions",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "promotions_seller_status_window_idx",
    "promotions_owner_status_window_idx",
    "promotion_scopes_target_idx",
    "coupons_code_uq",
    "coupons_promotion_status_idx",
    "coupon_redemptions_coupon_order_uq",
    "coupon_redemptions_coupon_customer_idx",
    "coupon_redemptions_order_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["promotions", "promotions_seller_id_sellers_id_fk"],
    ["promotions", "promotions_owner_type_check"],
    ["promotions", "promotions_owner_seller_check"],
    ["promotions", "promotions_type_normalized_check"],
    ["promotions", "promotions_value_positive_check"],
    ["promotions", "promotions_percentage_bounded_check"],
    ["promotions", "promotions_date_range_check"],
    ["promotions", "promotions_status_check"],
    ["promotions", "promotions_funding_type_check"],
    ["promotions", "promotions_seller_funding_check"],
    ["promotion_scopes", "promotion_scopes_pk"],
    ["promotion_scopes", "promotion_scopes_promotion_id_promotions_id_fk"],
    ["promotion_scopes", "promotion_scopes_type_normalized_check"],
    ["coupons", "coupons_promotion_id_promotions_id_fk"],
    ["coupons", "coupons_code_normalized_check"],
    ["coupons", "coupons_max_uses_check"],
    ["coupons", "coupons_max_uses_per_customer_check"],
    ["coupons", "coupons_status_check"],
    ["coupon_redemptions", "coupon_redemptions_coupon_id_coupons_id_fk"],
    [
      "coupon_redemptions",
      "coupon_redemptions_customer_fk",
    ],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const value = await columnDefinition("promotions", "value");
  assertCondition(
    value?.data_type === "numeric" && value.numeric_precision === 18 && value.numeric_scale === 4,
    "promotions.value must be NUMERIC(18,4).",
  );

  const orderId = await columnDefinition("coupon_redemptions", "order_id");
  assertCondition(
    orderId?.data_type === "uuid" && orderId.is_nullable === "NO",
    "coupon_redemptions.order_id must be a required UUID.",
  );
}

/** Proves promotion ownership, date, percentage, status, and funding checks reject invalid rows. */
async function verifyPromotionGuards(fixture) {
  await expectDatabaseError(
    `insert into promotions (owner_type, seller_id, name, type, value, start_at, end_at, status, funding_type)
     values ('seller', null, 'Invalid seller promotion', 'percentage', 10, now(), now() + interval '1 day', 'draft', 'seller')`,
    [],
    "23514",
    "Seller-owned promotions must require seller_id.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, seller_id, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', $1, 'Invalid platform promotion', 'percentage', 10, now(), now() + interval '1 day', 'draft', 'platform')`,
    [fixture.seller_id],
    "23514",
    "Platform-owned promotions must not store seller_id.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', 'Invalid dates', 'percentage', 10, now(), now(), 'draft', 'platform')`,
    [],
    "23514",
    "Promotion start_at must be earlier than end_at.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', 'Invalid type normalization', 'Percentage', 10, now(), now() + interval '1 day', 'draft', 'platform')`,
    [],
    "23514",
    "Promotion types must be normalized lowercase values.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, seller_id, name, type, value, start_at, end_at, status, funding_type)
     values ('seller', $1, 'Invalid seller funding', 'percentage', 10, now(), now() + interval '1 day', 'draft', 'platform')`,
    [fixture.seller_id],
    "23514",
    "Seller-owned promotions must remain seller-funded.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', 'Invalid percentage', 'percentage', 100.01, now(), now() + interval '1 day', 'draft', 'platform')`,
    [],
    "23514",
    "Percentage promotions must be bounded to 100.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', 'Invalid value', 'fixed_amount', 0, now(), now() + interval '1 day', 'draft', 'platform')`,
    [],
    "23514",
    "Promotion values must be positive.",
  );

  await expectDatabaseError(
    `insert into promotions (owner_type, name, type, value, start_at, end_at, status, funding_type)
     values ('platform', 'Invalid status', 'percentage', 10, now(), now() + interval '1 day', 'deleted', 'platform')`,
    [],
    "23514",
    "Promotion status must remain within the lifecycle allow-list.",
  );
}

/** Creates one valid promotion and proves scope/coupon/redemption integrity constraints. */
async function verifyCouponAndScopeGuards(fixture) {
  const promotion = await pool.query(
    `insert into promotions (owner_type, seller_id, name, type, value, start_at, end_at, status, funding_type)
     values ('seller', $1, 'Seller promotion', 'percentage', 10, now(), now() + interval '7 days', 'draft', 'seller')
     returning id`,
    [fixture.seller_id],
  );
  const promotionId = promotion.rows[0]?.id;

  await pool.query(
    `insert into promotion_scopes (promotion_id, scope_type, scope_id)
     values ($1, 'product', $2)`,
    [promotionId, fixture.product_id],
  );

  await expectDatabaseError(
    `insert into promotion_scopes (promotion_id, scope_type, scope_id)
     values ($1, 'product', $2)`,
    [promotionId, fixture.product_id],
    "23505",
    "Database must prevent duplicate promotion scopes.",
  );

  await expectDatabaseError(
    `insert into promotion_scopes (promotion_id, scope_type, scope_id)
     values ($1, 'Product', $2)`,
    [promotionId, fixture.product_id],
    "23514",
    "Promotion scope types must be normalized.",
  );

  const coupon = await pool.query(
    `insert into coupons (promotion_id, code, max_uses, max_uses_per_customer, status)
     values ($1, 'SAVE10', 100, 1, 'active') returning id`,
    [promotionId],
  );
  const couponId = coupon.rows[0]?.id;

  await expectDatabaseError(
    `insert into coupons (promotion_id, code, status) values ($1, 'save10', 'active')`,
    [promotionId],
    "23514",
    "Coupon codes must be stored in normalized uppercase form.",
  );

  await expectDatabaseError(
    `insert into coupons (promotion_id, code, status) values ($1, 'SAVE10', 'active')`,
    [promotionId],
    "23505",
    "Coupon codes must be unique.",
  );

  await expectDatabaseError(
    `insert into coupons (promotion_id, code, max_uses, status) values ($1, 'ZERO', 0, 'active')`,
    [promotionId],
    "23514",
    "Coupon max_uses must be positive when present.",
  );

  const orderId = "00000000-0000-4000-8000-000000000901";
  await pool.query(
    `insert into coupon_redemptions (coupon_id, customer_user_id, order_id)
     values ($1, $2, $3)`,
    [couponId, fixture.customer_user_id, orderId],
  );

  await expectDatabaseError(
    `insert into coupon_redemptions (coupon_id, customer_user_id, order_id)
     values ($1, $2, $3)`,
    [couponId, fixture.customer_user_id, orderId],
    "23505",
    "The same coupon cannot be redeemed twice for the same order identifier.",
  );
}

/** Verifies a clean database can reach Module 9 through the complete accepted migration history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await applyMigration(module9Migration);
  await verifyPromotionsSchema();

  const fixture = await createPrerequisiteFixture();
  await verifyPromotionGuards(fixture);
  await verifyCouponAndScopeGuards(fixture);
}

/** Verifies upgrading the accepted pre-Module-9 schema preserves authoritative prerequisite data. */
async function verifyUpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await createPrerequisiteFixture();

  const before = await pool.query(
    `select
       (select count(*) from users) as users,
       (select count(*) from customer_profiles) as customer_profiles,
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores,
       (select count(*) from categories) as categories,
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from carts) as carts,
       (select count(*) from wishlists) as wishlists`,
  );

  await applyMigration(module9Migration);
  await verifyPromotionsSchema();

  const after = await pool.query(
    `select
       (select count(*) from users) as users,
       (select count(*) from customer_profiles) as customer_profiles,
       (select count(*) from sellers) as sellers,
       (select count(*) from stores) as stores,
       (select count(*) from categories) as categories,
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from carts) as carts,
       (select count(*) from wishlists) as wishlists`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 9 migration changed existing Customer, Seller, Catalog, Product, or Cart/Wishlist data.",
  );
}

/** Runs clean-schema and supported pre-Module-9 upgrade verification. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyUpgradePath();
    console.log("Module 9 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
