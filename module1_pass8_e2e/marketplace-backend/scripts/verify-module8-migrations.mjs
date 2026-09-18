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
];
const module8Migration = "0017_cart_wishlist.sql";

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

/** Applies every accepted migration that exists before Module 8. */
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

/** Returns basic metadata for one public database column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, column_default, character_maximum_length
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

/** Creates authoritative Customer/Product/Inventory fixture rows without using any Module 8 table. */
async function createPrerequisiteFixture() {
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('module8-migration-seller@example.com', 'migration-password-hash', 'Module 8 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ('module8-migration-customer@example.com', 'migration-password-hash', 'Module 8 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 8 Customer', 'active' from customer_user
       returning user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 8 Seller', 'Module 8 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, 'module8-migration-store', 'Module 8 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ('module8-migration-category', 'Module 8 Category', 'active', 0)
       returning id
     ), product_one as (
       insert into products (seller_id, store_id, category_id, slug, name, description, status, publication_status, created_by)
       select seller_row.id, store_row.id, category_row.id,
              'module8-product-one', 'Module 8 Product One', 'Module 8 Product One',
              'active', 'draft', seller_user.id
       from seller_user, seller_row, store_row, category_row
       returning id
     ), product_two as (
       insert into products (seller_id, store_id, category_id, slug, name, description, status, publication_status, created_by)
       select seller_row.id, store_row.id, category_row.id,
              'module8-product-two', 'Module 8 Product Two', 'Module 8 Product Two',
              'active', 'draft', seller_user.id
       from seller_user, seller_row, store_row, category_row
       returning id
     ), variant_one as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, 'MODULE8-SKU-ONE', 'Module 8 Variant One', 10.00, 'USD', 'active' from product_one
       returning id, product_id
     ), variant_two as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, 'MODULE8-SKU-TWO', 'Module 8 Variant Two', 20.00, 'USD', 'active' from product_two
       returning id, product_id
     ), inventory_row as (
       insert into inventory_items (seller_id, store_id, variant_id, on_hand_qty, reserved_qty)
       select seller_row.id, store_row.id, variant_one.id, 25, 0
       from seller_row, store_row, variant_one
       returning id
     )
     select customer_profile.user_id as customer_user_id,
            product_one.id as product_one_id,
            product_two.id as product_two_id,
            variant_one.id as variant_one_id,
            variant_two.id as variant_two_id,
            inventory_row.id as inventory_item_id
       from customer_profile, product_one, product_two, variant_one, variant_two, inventory_row`,
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.customer_user_id), "Module 8 fixture could not create a Customer profile.");
  assertCondition(Boolean(fixture?.variant_one_id), "Module 8 fixture could not create Product variants.");
  return fixture;
}

/** Verifies all Module 8 tables, indexes, foreign keys, and local checks exist. */
async function verifyCartWishlistSchema() {
  for (const tableName of ["carts", "cart_items", "wishlists", "wishlist_items"]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "carts_customer_user_id_uq",
    "cart_items_cart_variant_uq",
    "wishlists_customer_default_uq",
    "wishlist_items_product_only_uq",
    "wishlist_items_variant_uq",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["carts", "carts_currency_check"],
    ["carts", "carts_customer_user_id_customer_profiles_user_id_fk"],
    ["cart_items", "cart_items_quantity_positive_check"],
    ["cart_items", "cart_items_cart_id_carts_id_fk"],
    ["cart_items", "cart_items_variant_id_product_variants_id_fk"],
    ["wishlists", "wishlists_name_not_blank_check"],
    ["wishlists", "wishlists_customer_user_id_customer_profiles_user_id_fk"],
    ["wishlist_items", "wishlist_items_wishlist_id_wishlists_id_fk"],
    ["wishlist_items", "wishlist_items_product_id_products_id_fk"],
    ["wishlist_items", "wishlist_items_variant_product_fk"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const currency = await columnDefinition("carts", "currency");
  assertCondition(
    currency?.data_type === "character varying" && currency.character_maximum_length === 3,
    "carts.currency must be VARCHAR(3).",
  );

  const quantity = await columnDefinition("cart_items", "quantity");
  assertCondition(quantity?.data_type === "integer", "cart_items.quantity must be INTEGER.");

  const wishlistVariant = await columnDefinition("wishlist_items", "variant_id");
  assertCondition(
    wishlistVariant?.data_type === "uuid" && wishlistVariant.is_nullable === "YES",
    "wishlist_items.variant_id must be a nullable UUID.",
  );
}

/** Proves the database guards customer-cart uniqueness and valid cart quantities/currency. */
async function verifyCartGuards(fixture) {
  const cart = await pool.query(
    `insert into carts (customer_user_id, currency) values ($1, 'USD') returning id`,
    [fixture.customer_user_id],
  );
  const cartId = cart.rows[0]?.id;

  await expectDatabaseError(
    `insert into carts (customer_user_id, currency) values ($1, 'USD')`,
    [fixture.customer_user_id],
    "23505",
    "Database must prevent more than one cart for the same customer.",
  );

  await expectDatabaseError(
    `update carts set currency = 'usd' where id = $1`,
    [cartId],
    "23514",
    "Database must reject non-normalized cart currency.",
  );

  await pool.query(
    `insert into cart_items (cart_id, variant_id, quantity) values ($1, $2, 2)`,
    [cartId, fixture.variant_one_id],
  );

  await expectDatabaseError(
    `insert into cart_items (cart_id, variant_id, quantity) values ($1, $2, 1)`,
    [cartId, fixture.variant_one_id],
    "23505",
    "Database must prevent duplicate logical cart variants.",
  );

  await expectDatabaseError(
    `insert into cart_items (cart_id, variant_id, quantity) values ($1, $2, 0)`,
    [cartId, fixture.variant_two_id],
    "23514",
    "Database must reject non-positive cart quantities.",
  );
}

/** Proves the database guards one default wishlist, duplicate entries, and Product/variant ownership. */
async function verifyWishlistGuards(fixture) {
  const wishlist = await pool.query(
    `insert into wishlists (customer_user_id, name, is_default)
     values ($1, 'My wishlist', true) returning id`,
    [fixture.customer_user_id],
  );
  const wishlistId = wishlist.rows[0]?.id;

  await expectDatabaseError(
    `insert into wishlists (customer_user_id, name, is_default)
     values ($1, 'Another default', true)`,
    [fixture.customer_user_id],
    "23505",
    "Database must prevent more than one default wishlist per customer.",
  );

  await pool.query(
    `insert into wishlist_items (wishlist_id, product_id)
     values ($1, $2)`,
    [wishlistId, fixture.product_one_id],
  );

  await expectDatabaseError(
    `insert into wishlist_items (wishlist_id, product_id)
     values ($1, $2)`,
    [wishlistId, fixture.product_one_id],
    "23505",
    "Database must prevent duplicate product-only wishlist entries.",
  );

  await pool.query(
    `insert into wishlist_items (wishlist_id, product_id, variant_id)
     values ($1, $2, $3)`,
    [wishlistId, fixture.product_two_id, fixture.variant_two_id],
  );

  await expectDatabaseError(
    `insert into wishlist_items (wishlist_id, product_id, variant_id)
     values ($1, $2, $3)`,
    [wishlistId, fixture.product_two_id, fixture.variant_two_id],
    "23505",
    "Database must prevent duplicate variant wishlist entries.",
  );

  await expectDatabaseError(
    `insert into wishlist_items (wishlist_id, product_id, variant_id)
     values ($1, $2, $3)`,
    [wishlistId, fixture.product_two_id, fixture.variant_one_id],
    "23503",
    "Database must reject a wishlist variant that belongs to another Product.",
  );
}

/** Verifies a clean database can reach Module 8 through the complete accepted migration history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await applyMigration(module8Migration);
  await verifyCartWishlistSchema();

  const fixture = await createPrerequisiteFixture();
  await verifyCartGuards(fixture);
  await verifyWishlistGuards(fixture);
}

/** Verifies upgrading the accepted pre-Module-8 schema does not rewrite authoritative source data. */
async function verifyUpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  await createPrerequisiteFixture();

  const before = await pool.query(
    `select
       (select count(*) from users) as users,
       (select count(*) from customer_profiles) as customer_profiles,
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from inventory_items) as inventory_items,
       (select coalesce(sum(on_hand_qty), 0) from inventory_items) as on_hand_qty,
       (select coalesce(sum(reserved_qty), 0) from inventory_items) as reserved_qty`,
  );

  await applyMigration(module8Migration);
  await verifyCartWishlistSchema();

  const after = await pool.query(
    `select
       (select count(*) from users) as users,
       (select count(*) from customer_profiles) as customer_profiles,
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants,
       (select count(*) from inventory_items) as inventory_items,
       (select coalesce(sum(on_hand_qty), 0) from inventory_items) as on_hand_qty,
       (select coalesce(sum(reserved_qty), 0) from inventory_items) as reserved_qty`,
  );

  assertCondition(
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    "Module 8 migration changed existing Customer, Product, or Inventory data.",
  );
}

/** Runs clean-schema and supported pre-Module-8 upgrade verification. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyUpgradePath();
    console.log("Module 8 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
