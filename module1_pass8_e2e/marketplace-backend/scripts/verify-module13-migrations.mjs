import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preFulfillmentMigrations = [
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
];
const fulfillmentMigration = "0027_shipping_fulfillment.sql";

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

/** Applies the released marketplace history through Module 16, immediately before fulfillment completion. */
async function applyPreFulfillmentHistory() {
  for (const migration of preFulfillmentMigrations) await applyMigration(migration);
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
    `select data_type, is_nullable, character_maximum_length, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Runs one statement expected to fail and confirms PostgreSQL rejected it with the requested code. */
async function expectDatabaseError(query, params, expectedCode, message) {
  let rejected = false;
  try {
    await pool.query(query, params);
  } catch (error) {
    rejected = error?.code === expectedCode;
  }
  assertCondition(rejected, message);
}

/** Applies a migration until the expected PostgreSQL error proves an unsafe legacy state is rejected. */
async function expectMigrationError(name, expectedCode, message) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (!statement.trim()) continue;
    try {
      await pool.query(statement);
    } catch (error) {
      assertCondition(error?.code === expectedCode, message);
      return;
    }
  }
  throw new Error(message);
}

/** Creates the minimum released Seller/Customer/Product/Checkout/Inventory data needed for an Order fixture. */
async function createPrerequisiteFixture(suffix) {
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($1, 'migration-password-hash', 'Module 13 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($2, 'migration-password-hash', 'Module 13 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 13 Customer', 'active' from customer_user
       returning user_id
     ), customer_address as (
       insert into customer_addresses (
         customer_user_id, label, recipient_name, phone, line1, city, region,
         country_code, is_default_shipping, is_default_billing, status
       )
       select user_id, 'Home', 'Module 13 Customer', '+1 555 0130', '13 Shipping Way',
              'Test City', 'Test Region', 'US', true, true, 'active'
         from customer_profile
       returning id, customer_user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 13 Seller', 'Module 13 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, $3, 'Module 13 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), shipping_method as (
       insert into shipping_methods (
         owner_type, seller_id, code, name, pricing_type, base_rate, currency, status
       )
       select 'seller', seller_row.id, $4, 'Module 13 Standard', 'flat', 12.0000, 'USD', 'active'
         from seller_row
       returning id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ($5, 'Module 13 Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (
         seller_id, store_id, category_id, slug, name, description,
         status, publication_status, created_by
       )
       select seller_row.id, store_row.id, category_row.id,
              $6, 'Module 13 Product', 'Module 13 Product',
              'active', 'draft', seller_user.id
         from seller_user, seller_row, store_row, category_row
       returning id, seller_id, store_id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, $7, 'Module 13 Variant', 100.0000, 'USD', 'active' from product_row
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
              now() + interval '30 minutes', repeat('b', 64)
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
              $4, 'Module 13 Standard', 12.0000, 'USD'
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
       select variant_row.id, attempt_row.customer_user_id, attempt_row.id, 2, 0,
              0, 'committed', now() + interval '30 minutes', $9
         from variant_row, attempt_row
       returning id
     )
     select customer_profile.user_id as customer_user_id,
            seller_row.id as seller_id,
            store_row.id as store_id,
            shipping_method.id as shipping_method_id,
            product_row.id as product_id,
            variant_row.id as variant_id,
            attempt_row.id as checkout_attempt_id,
            reservation_row.id as reservation_id
       from customer_profile, seller_row, store_row, shipping_method,
            product_row, variant_row, attempt_row, reservation_row`,
    [
      `module13-migration-seller-${suffix}@example.com`,
      `module13-migration-customer-${suffix}@example.com`,
      `module13-migration-store-${suffix}`,
      `MODULE13-${suffix.toUpperCase()}-SHIP`,
      `module13-migration-category-${suffix}`,
      `module13-migration-product-${suffix}`,
      `MODULE13-${suffix.toUpperCase()}-SKU`,
      `module13-attempt-${suffix}`,
      `module13-reservation-${suffix}`,
    ],
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.checkout_attempt_id), "Module 13 fixture could not create Checkout attempt.");
  assertCondition(Boolean(fixture?.reservation_id), "Module 13 fixture could not create Inventory reservation.");
  return fixture;
}

/** Creates one captured/processing Seller Order and immutable Order Item before or after migration 0027. */
async function createOrderFixture(fixture) {
  const orderId = randomUUID();
  const sellerOrderId = randomUUID();
  const orderItemId = randomUUID();
  const orderNo = `ORD-${orderId.replaceAll("-", "").toUpperCase()}`;
  const sellerOrderNo = `SOR-${sellerOrderId.replaceAll("-", "").toUpperCase()}`;

  await pool.query(
    `insert into orders (
       id, order_no, checkout_attempt_id, customer_user_id, currency,
       subtotal, discount_total, tax_total, shipping_total, grand_total,
       payment_status, fulfillment_status, order_status, placed_at
     ) values (
       $1, $2, $3, $4, 'USD',
       200.0000, 0.0000, 20.0000, 12.0000, 232.0000,
       'captured', 'unfulfilled', 'confirmed', now()
     )`,
    [orderId, orderNo, fixture.checkout_attempt_id, fixture.customer_user_id],
  );

  await pool.query(
    `insert into seller_orders (
       id, order_id, seller_id, store_id, seller_order_no,
       subtotal, discount_total, tax_total, shipping_total, grand_total,
       status, shipping_method_id, shipping_method_code_snapshot, shipping_method_name_snapshot
     ) values (
       $1, $2, $3, $4, $5,
       200.0000, 0.0000, 20.0000, 12.0000, 232.0000,
       'processing', $6, 'MODULE13-SHIP', 'Module 13 Standard'
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
       id, order_id, seller_order_id, product_id, variant_id, inventory_reservation_id,
       sku_snapshot, name_snapshot, variant_title_snapshot, qty,
       unit_price, discount_allocated, tax_allocated, line_total
     ) values (
       $1, $2, $3, $4, $5, $6,
       'MODULE13-SKU', 'Module 13 Product', 'Module 13 Variant', 2,
       100.0000, 0.0000, 20.0000, 220.0000
     )`,
    [
      orderItemId,
      orderId,
      sellerOrderId,
      fixture.product_id,
      fixture.variant_id,
      fixture.reservation_id,
    ],
  );

  await pool.query(`update checkout_attempts set order_id = $1 where id = $2`, [
    orderId,
    fixture.checkout_attempt_id,
  ]);

  return { orderId, sellerOrderId, orderItemId };
}

/** Verifies the Stage 11 Shipping Core table remains intact after fulfillment completion. */
async function verifyShippingCoreStillPresent() {
  assertCondition(await tableExists("shipping_methods"), "shipping_methods table is missing.");
  for (const constraintName of [
    "shipping_methods_owner_type_check",
    "shipping_methods_owner_seller_check",
    "shipping_methods_pricing_type_check",
    "shipping_methods_currency_check",
    "shipping_methods_status_check",
  ]) {
    assertCondition(
      await constraintExists("shipping_methods", constraintName),
      `shipping_methods.${constraintName} is missing.`,
    );
  }
}

/** Verifies all Stage 16 fulfillment tables, indexes, foreign keys, and row-local guards exist. */
async function verifyFulfillmentSchema() {
  for (const tableName of ["shipments", "shipment_items", "shipment_status_history"]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "shipments_shipment_no_uq",
    "shipments_seller_order_status_created_idx",
    "shipments_status_created_idx",
    "shipment_items_order_item_idx",
    "shipment_status_history_shipment_occurred_idx",
    "shipment_status_history_status_occurred_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} index is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["orders", "orders_fulfillment_status_check"],
    ["shipments", "shipments_seller_order_id_seller_orders_id_fk"],
    ["shipments", "shipments_number_matches_id_check"],
    ["shipments", "shipments_status_check"],
    ["shipments", "shipments_tracking_required_after_ship_check"],
    ["shipments", "shipments_lifecycle_timestamps_check"],
    ["shipment_items", "shipment_items_pk"],
    ["shipment_items", "shipment_items_shipment_id_shipments_id_fk"],
    ["shipment_items", "shipment_items_order_item_id_order_items_id_fk"],
    ["shipment_items", "shipment_items_quantity_positive_check"],
    ["shipment_status_history", "shipment_status_history_shipment_id_shipments_id_fk"],
    ["shipment_status_history", "shipment_status_history_status_check"],
    ["shipment_status_history", "shipment_status_history_source_not_blank_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const shipmentNo = await columnDefinition("shipments", "shipment_no");
  assertCondition(
    shipmentNo?.data_type === "character varying" &&
      shipmentNo.character_maximum_length === 40 &&
      shipmentNo.is_nullable === "NO",
    "shipments.shipment_no must be required varchar(40).",
  );

  const shippedAt = await columnDefinition("shipments", "shipped_at");
  const deliveredAt = await columnDefinition("shipments", "delivered_at");
  assertCondition(
    shippedAt?.data_type === "timestamp with time zone" && shippedAt.is_nullable === "YES",
    "shipments.shipped_at must be nullable timestamptz.",
  );
  assertCondition(
    deliveredAt?.data_type === "timestamp with time zone" && deliveredAt.is_nullable === "YES",
    "shipments.delivered_at must be nullable timestamptz.",
  );
}

/** Proves the new fulfillment checks reject invalid rows without hiding business decisions in the database. */
async function verifyFulfillmentGuards(orderFixture) {
  const shipmentId = randomUUID();
  const shipmentNo = `SHP-${shipmentId.replaceAll("-", "").toUpperCase()}`;

  await pool.query(
    `insert into shipments (id, seller_order_id, shipment_no, status)
     values ($1, $2, $3, 'created')`,
    [shipmentId, orderFixture.sellerOrderId, shipmentNo],
  );
  await pool.query(
    `insert into shipment_items (shipment_id, order_item_id, quantity)
     values ($1, $2, 1)`,
    [shipmentId, orderFixture.orderItemId],
  );
  await pool.query(
    `insert into shipment_status_history (shipment_id, status, source)
     values ($1, 'created', 'seller')`,
    [shipmentId],
  );

  await expectDatabaseError(
    `insert into shipments (seller_order_id, shipment_no, status)
     values ($1, 'SHP-NOT-THE-ROW-ID', 'created')`,
    [orderFixture.sellerOrderId],
    "23514",
    "Shipment number must be derived from the Shipment UUID.",
  );

  const invalidStatusId = randomUUID();
  await expectDatabaseError(
    `insert into shipments (id, seller_order_id, shipment_no, status)
     values ($1, $2, $3, 'cancelled')`,
    [
      invalidStatusId,
      orderFixture.sellerOrderId,
      `SHP-${invalidStatusId.replaceAll("-", "").toUpperCase()}`,
    ],
    "23514",
    "Shipment status must stay inside created/shipped/delivered.",
  );

  const shippedWithoutTrackingId = randomUUID();
  await expectDatabaseError(
    `insert into shipments (id, seller_order_id, shipment_no, status, shipped_at)
     values ($1, $2, $3, 'shipped', now())`,
    [
      shippedWithoutTrackingId,
      orderFixture.sellerOrderId,
      `SHP-${shippedWithoutTrackingId.replaceAll("-", "").toUpperCase()}`,
    ],
    "23514",
    "A shipped Shipment must have carrier and tracking values.",
  );

  await expectDatabaseError(
    `insert into shipment_items (shipment_id, order_item_id, quantity)
     values ($1, $2, 0)`,
    [shipmentId, orderFixture.orderItemId],
    "23514",
    "Shipment Item quantity must be positive.",
  );

  await expectDatabaseError(
    `insert into shipment_items (shipment_id, order_item_id, quantity)
     values ($1, $2, 1)`,
    [shipmentId, orderFixture.orderItemId],
    "23505",
    "A Shipment cannot contain the same Order Item twice.",
  );

  await expectDatabaseError(
    `insert into shipment_status_history (shipment_id, status, source)
     values ($1, 'returned', 'seller')`,
    [shipmentId],
    "23514",
    "Shipment history must use the approved lifecycle statuses.",
  );

  await expectDatabaseError(
    `insert into shipment_status_history (shipment_id, status, source)
     values ($1, 'created', '   ')`,
    [shipmentId],
    "23514",
    "Shipment history source must not be blank.",
  );

  await expectDatabaseError(
    `update orders set fulfillment_status = 'shipping' where id = $1`,
    [orderFixture.orderId],
    "23514",
    "Order fulfillment status must stay inside the approved Stage 16 values.",
  );

  await pool.query(
    `update shipments
        set carrier = 'Carrier', tracking_no = 'TRACK-13', status = 'shipped',
            shipped_at = now(), updated_at = now()
      where id = $1`,
    [shipmentId],
  );
  await pool.query(
    `update shipments
        set status = 'delivered', delivered_at = now(), updated_at = now()
      where id = $1`,
    [shipmentId],
  );

  const delivered = await pool.query(
    `select status, shipped_at, delivered_at from shipments where id = $1`,
    [shipmentId],
  );
  assertCondition(delivered.rows[0]?.status === "delivered", "Valid Shipment lifecycle row was not preserved.");
  assertCondition(Boolean(delivered.rows[0]?.shipped_at), "Valid Shipment shipped_at was not preserved.");
  assertCondition(Boolean(delivered.rows[0]?.delivered_at), "Valid Shipment delivered_at was not preserved.");
}

/** Verifies a clean database reaches the Stage 16 fulfillment schema through append-only history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPreFulfillmentHistory();
  await applyMigration(fulfillmentMigration);
  await verifyShippingCoreStillPresent();
  await verifyFulfillmentSchema();

  const fixture = await createPrerequisiteFixture("clean");
  const orderFixture = await createOrderFixture(fixture);
  await verifyFulfillmentGuards(orderFixture);
}

/** Verifies upgrading the released pre-0027 schema preserves existing Shipping Core and Order data. */
async function verifyUpgradePath() {
  await resetSchema();
  await applyPreFulfillmentHistory();
  const fixture = await createPrerequisiteFixture("upgrade");
  const orderFixture = await createOrderFixture(fixture);

  const before = await pool.query(
    `select fulfillment_status from orders where id = $1`,
    [orderFixture.orderId],
  );
  assertCondition(before.rows[0]?.fulfillment_status === "unfulfilled", "Pre-0027 Order fixture is invalid.");

  await applyMigration(fulfillmentMigration);
  await verifyShippingCoreStillPresent();
  await verifyFulfillmentSchema();

  const preserved = await pool.query(
    `select o.fulfillment_status, so.status as seller_order_status, sm.status as shipping_method_status
       from orders o
       join seller_orders so on so.order_id = o.id
       join shipping_methods sm on sm.id = so.shipping_method_id
      where o.id = $1`,
    [orderFixture.orderId],
  );
  assertCondition(preserved.rows[0]?.fulfillment_status === "unfulfilled", "Existing Order fulfillment status changed during 0027.");
  assertCondition(preserved.rows[0]?.seller_order_status === "processing", "Existing Seller Order status changed during 0027.");
  assertCondition(preserved.rows[0]?.shipping_method_status === "active", "Existing Shipping method changed during 0027.");

  const fulfillmentRows = await pool.query(
    `select
       (select count(*)::int from shipments) as shipments,
       (select count(*)::int from shipment_items) as shipment_items,
       (select count(*)::int from shipment_status_history) as history`,
  );
  assertCondition(fulfillmentRows.rows[0]?.shipments === 0, "0027 must not invent Shipments during upgrade.");
  assertCondition(fulfillmentRows.rows[0]?.shipment_items === 0, "0027 must not invent Shipment Items during upgrade.");
  assertCondition(fulfillmentRows.rows[0]?.history === 0, "0027 must not invent Shipment history during upgrade.");

  await verifyFulfillmentGuards(orderFixture);
}

/** Verifies 0027 fails loudly rather than rewriting an unsupported historical Order fulfillment status. */
async function verifyUnsafeLegacyStatusRejection() {
  await resetSchema();
  await applyPreFulfillmentHistory();
  const fixture = await createPrerequisiteFixture("unsafe");
  const orderFixture = await createOrderFixture(fixture);

  await pool.query(
    `update orders set fulfillment_status = 'shipping' where id = $1`,
    [orderFixture.orderId],
  );

  await expectMigrationError(
    fulfillmentMigration,
    "23514",
    "0027 must reject unsupported historical fulfillment statuses instead of silently rewriting them.",
  );
}

/** Runs clean, supported-upgrade, and unsafe-legacy migration proof and always closes the database pool. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyUpgradePath();
    await verifyUnsafeLegacyStatusRejection();
    console.log("Module 13 Shipping & Fulfillment Completion migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
