import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preModule11Migrations = [
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
];
const module11Migration = "0023_orders_persistence.sql";

/** Resets the disposable public schema before one destructive migration scenario. */
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

/** Applies every accepted migration that existed before Module 11 Pass 1. */
async function applyPreModule11Migrations() {
  for (const migration of preModule11Migrations) await applyMigration(migration);
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
    `select data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Runs a statement expected to fail and verifies PostgreSQL rejected it with the requested code. */
async function expectDatabaseError(query, params, expectedCode, message) {
  let rejected = false;
  try {
    await pool.query(query, params);
  } catch (error) {
    rejected = error?.code === expectedCode;
  }
  assertCondition(rejected, message);
}

/** Creates one valid pre-Module-11 Checkout/Inventory fixture for upgrade-preservation checks. */
async function createPreModule11Fixture(suffix) {
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($1, 'migration-password-hash', 'Module 11 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($2, 'migration-password-hash', 'Module 11 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 11 Customer', 'active' from customer_user
       returning user_id
     ), customer_address as (
       insert into customer_addresses (
         customer_user_id, label, recipient_name, phone, line1, city, region,
         country_code, is_default_shipping, is_default_billing, status
       )
       select user_id, 'Home', 'Module 11 Customer', '+1 555 0111', '11 Orders Way',
              'Test City', 'Test Region', 'US', true, true, 'active'
         from customer_profile
       returning id, customer_user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 11 Seller', 'Module 11 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, $3, 'Module 11 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), shipping_method as (
       insert into shipping_methods (
         owner_type, seller_id, code, name, pricing_type, base_rate, currency, status
       )
       select 'seller', seller_row.id, $4, 'Module 11 Standard', 'flat', 12.0000, 'USD', 'active'
         from seller_row
       returning id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ($5, 'Module 11 Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (
         seller_id, store_id, category_id, slug, name, description,
         status, publication_status, created_by
       )
       select seller_row.id, store_row.id, category_row.id,
              $6, 'Module 11 Product', 'Module 11 Product',
              'active', 'draft', seller_user.id
         from seller_user, seller_row, store_row, category_row
       returning id, seller_id, store_id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, $7, 'Module 11 Variant', 100.0000, 'USD', 'active' from product_row
       returning id
     ), inventory_row as (
       insert into inventory_items (seller_id, store_id, variant_id, on_hand_qty, reserved_qty)
       select product_row.seller_id, product_row.store_id, variant_row.id, 10, 2
         from product_row, variant_row
       returning id
     ), quote_row as (
       insert into checkout_quotes (
         customer_user_id, shipping_address_id, billing_address_id, currency,
         subtotal, discount_total, tax_total, shipping_total, grand_total,
         expires_at, state_hash
       )
       select customer_profile.user_id, customer_address.id, customer_address.id, 'USD',
              200.0000, 0.0000, 20.0000, 12.0000, 232.0000,
              now() + interval '30 minutes', repeat('a', 64)
         from customer_profile, customer_address
       returning id, customer_user_id
     ), quote_line as (
       insert into checkout_quote_lines (
         quote_id, variant_id, seller_id, store_id, qty, unit_price, discount, tax, line_total
       )
       select quote_row.id, variant_row.id, seller_row.id, store_row.id,
              2, 100.0000, 0.0000, 20.0000, 220.0000
         from quote_row, variant_row, seller_row, store_row
       returning quote_id
     ), quote_shipping as (
       insert into checkout_quote_shipping_selections (
         quote_id, seller_id, store_id, shipping_method_id,
         shipping_method_code_snapshot, shipping_method_name_snapshot, amount, currency
       )
       select quote_row.id, seller_row.id, store_row.id, shipping_method.id,
              $4, 'Module 11 Standard', 12.0000, 'USD'
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
         status, expires_at, source_key
       )
       select variant_row.id, attempt_row.customer_user_id, attempt_row.id, 2, 0,
              'reserved', now() + interval '30 minutes', $9
         from variant_row, attempt_row
       returning id
     )
     select customer_profile.user_id as customer_user_id,
            customer_address.id as address_id,
            seller_row.id as seller_id,
            store_row.id as store_id,
            shipping_method.id as shipping_method_id,
            product_row.id as product_id,
            variant_row.id as variant_id,
            inventory_row.id as inventory_item_id,
            attempt_row.id as checkout_attempt_id,
            reservation_row.id as reservation_id
       from customer_profile, customer_address, seller_row, store_row, shipping_method,
            product_row, variant_row, inventory_row, attempt_row, reservation_row`,
    [
      `module11-migration-seller-${suffix}@example.com`,
      `module11-migration-customer-${suffix}@example.com`,
      `module11-migration-store-${suffix}`,
      `MODULE11-${suffix.toUpperCase()}-SHIP`,
      `module11-migration-category-${suffix}`,
      `module11-migration-product-${suffix}`,
      `MODULE11-${suffix.toUpperCase()}-SKU`,
      `module11-attempt-${suffix}`,
      `module11-reservation-${suffix}`,
    ],
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.checkout_attempt_id), "Module 11 fixture could not create Checkout attempt.");
  assertCondition(Boolean(fixture?.reservation_id), "Module 11 fixture could not create Inventory reservation.");
  return fixture;
}

/** Verifies Module 11 tables, foreign keys, indexes, money columns, and Inventory extension exist. */
async function verifyModule11Schema() {
  for (const tableName of [
    "orders",
    "seller_orders",
    "order_items",
    "order_addresses",
    "order_status_history",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  const releasedQty = await columnDefinition("stock_reservations", "released_qty");
  assertCondition(releasedQty?.data_type === "integer", "stock_reservations.released_qty must be integer.");
  assertCondition(releasedQty?.is_nullable === "NO", "stock_reservations.released_qty must be NOT NULL.");

  for (const [tableName, columnName] of [
    ["orders", "subtotal"],
    ["orders", "grand_total"],
    ["seller_orders", "subtotal"],
    ["seller_orders", "grand_total"],
    ["order_items", "unit_price"],
    ["order_items", "line_total"],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(
      definition?.numeric_precision === 18 && definition?.numeric_scale === 4,
      `${tableName}.${columnName} must be NUMERIC(18,4).`,
    );
  }

  for (const indexName of [
    "orders_order_no_uq",
    "orders_checkout_attempt_uq",
    "orders_customer_created_idx",
    "seller_orders_seller_order_no_uq",
    "seller_orders_order_seller_store_uq",
    "order_items_inventory_reservation_uq",
    "order_addresses_order_type_uq",
    "order_status_history_source_uq",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} index is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["stock_reservations", "stock_reservations_accounted_qty_range_check"],
    ["orders", "orders_checkout_attempt_id_checkout_attempts_id_fk"],
    ["seller_orders", "seller_orders_store_seller_fk"],
    ["order_items", "order_items_seller_order_parent_fk"],
    ["order_items", "order_items_variant_product_fk"],
    ["order_addresses", "order_addresses_order_id_orders_id_fk"],
    ["order_status_history", "order_status_history_one_target_check"],
    ["coupon_redemptions", "coupon_redemptions_order_id_orders_id_fk"],
    ["checkout_attempts", "checkout_attempts_order_id_orders_id_fk"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${constraintName} constraint is missing.`,
    );
  }
}

/** Inserts one complete immutable Order snapshot and verifies the circular Checkout link can be completed. */
async function verifyOrderPersistence(fixture) {
  const orderId = randomUUID();
  const sellerOrderId = randomUUID();
  const orderNo = `ORD-${orderId.replaceAll("-", "").toUpperCase()}`;
  const sellerOrderNo = `SOR-${sellerOrderId.replaceAll("-", "").toUpperCase()}`;

  await pool.query(
    `insert into orders (
       id, order_no, checkout_attempt_id, customer_user_id, currency,
       subtotal, discount_total, tax_total, shipping_total, grand_total
     ) values ($1, $2, $3, $4, 'USD', 200.0000, 0.0000, 20.0000, 12.0000, 232.0000)`,
    [orderId, orderNo, fixture.checkout_attempt_id, fixture.customer_user_id],
  );

  await pool.query(
    `insert into seller_orders (
       id, order_id, seller_id, store_id, seller_order_no,
       subtotal, discount_total, tax_total, shipping_total, grand_total,
       shipping_method_id, shipping_method_code_snapshot, shipping_method_name_snapshot
     ) values (
       $1, $2, $3, $4, $5,
       200.0000, 0.0000, 20.0000, 12.0000, 232.0000,
       $6, 'MODULE11-SHIP', 'Module 11 Standard'
     )`,
    [
      sellerOrderId,
      orderId,
      fixture.seller_id,
      fixture.store_id,
      sellerOrderNo,
      fixture.shipping_method_id,
    ],
  );

  await pool.query(
    `insert into order_items (
       order_id, seller_order_id, product_id, variant_id, inventory_reservation_id,
       sku_snapshot, name_snapshot, variant_title_snapshot, qty,
       unit_price, discount_allocated, tax_allocated, line_total
     ) values ($1, $2, $3, $4, $5, 'MODULE11-SKU', 'Module 11 Product', 'Module 11 Variant', 2,
               100.0000, 0.0000, 20.0000, 220.0000)`,
    [orderId, sellerOrderId, fixture.product_id, fixture.variant_id, fixture.reservation_id],
  );

  for (const type of ["shipping", "billing"]) {
    await pool.query(
      `insert into order_addresses (
         order_id, type, source_address_id, recipient_name, phone,
         line1, city, region, country_code
       ) values ($1, $2, $3, 'Module 11 Customer', '+1 555 0111',
                 '11 Orders Way', 'Test City', 'Test Region', 'US')`,
      [orderId, type, fixture.address_id],
    );
  }

  await pool.query(
    `insert into order_status_history (order_id, to_status, source_type, source_key)
     values ($1, 'pending_payment', 'checkout', $2)`,
    [orderId, `checkout:${fixture.checkout_attempt_id}`],
  );
  await pool.query(`update checkout_attempts set order_id = $1 where id = $2`, [
    orderId,
    fixture.checkout_attempt_id,
  ]);

  const linked = await pool.query(
    `select o.id as order_id, ca.order_id as checkout_order_id
       from orders o
       join checkout_attempts ca on ca.id = o.checkout_attempt_id
      where o.id = $1`,
    [orderId],
  );
  assertCondition(
    linked.rows[0]?.checkout_order_id === orderId,
    "Checkout attempt and Order must support the approved two-way link.",
  );

  const duplicateOrderId = randomUUID();
  await expectDatabaseError(
    `insert into orders (
       id, order_no, checkout_attempt_id, customer_user_id, currency,
       subtotal, discount_total, tax_total, shipping_total, grand_total
     ) values ($1, $2, $3, $4, 'USD', 200.0000, 0.0000, 20.0000, 12.0000, 232.0000)`,
    [
      duplicateOrderId,
      `ORD-${duplicateOrderId.replaceAll("-", "").toUpperCase()}`,
      fixture.checkout_attempt_id,
      fixture.customer_user_id,
    ],
    "23505",
    "One Checkout attempt must not create two Orders.",
  );
}

/** Verifies clean migration from Foundation through Module 11. */
async function verifyCleanMigration() {
  await resetSchema();
  await applyPreModule11Migrations();
  await applyMigration(module11Migration);
  await verifyModule11Schema();
}

/** Verifies upgrade from the accepted Module 10 schema preserves existing reservation data. */
async function verifySupportedUpgrade() {
  await resetSchema();
  await applyPreModule11Migrations();
  const fixture = await createPreModule11Fixture("upgrade");

  await applyMigration(module11Migration);
  await verifyModule11Schema();

  const reservation = await pool.query(
    `select qty, consumed_qty, released_qty, status
       from stock_reservations
      where id = $1`,
    [fixture.reservation_id],
  );
  assertCondition(reservation.rows[0]?.released_qty === 0, "Existing reservations must backfill released_qty to zero.");
  assertCondition(reservation.rows[0]?.consumed_qty === 0, "Existing reservation consumed quantity changed unexpectedly.");
  assertCondition(reservation.rows[0]?.status === "reserved", "Existing reservation status changed unexpectedly.");

  await verifyOrderPersistence(fixture);

  await expectDatabaseError(
    `update stock_reservations set released_qty = qty + 1 where id = $1`,
    [fixture.reservation_id],
    "23514",
    "Reservation released quantity must never exceed the unconsumed reservation quantity.",
  );
}

try {
  await verifyCleanMigration();
  await verifySupportedUpgrade();
  console.log("Module 11 clean and supported-upgrade migration verification passed.");
} finally {
  await pool.end();
}
