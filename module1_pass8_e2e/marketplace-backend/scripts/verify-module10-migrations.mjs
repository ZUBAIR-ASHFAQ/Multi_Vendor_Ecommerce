import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preContractMigrations = [
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
];
const checkoutContractMigration = "0022_checkout_contract_persistence.sql";

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

/** Applies the accepted schema that exists immediately before Pass 3 persistence hardening. */
async function applyPreContractMigrations() {
  for (const migration of preContractMigrations) await applyMigration(migration);
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

/** Creates Customer, address, Seller, Store, Product, Variant, Inventory, and Shipping rows for Checkout checks. */
async function createCheckoutFixture(suffix) {
  const result = await pool.query(
    `with seller_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($1, 'migration-password-hash', 'Module 10 Seller', 'seller', 'active')
       returning id
     ), customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($2, 'migration-password-hash', 'Module 10 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 10 Customer', 'active' from customer_user
       returning user_id
     ), customer_address as (
       insert into customer_addresses (
         customer_user_id, label, recipient_name, phone, line1, city, region,
         country_code, is_default_shipping, is_default_billing, status
       )
       select user_id, 'Home', 'Module 10 Customer', '+1 555 0100', '1 Checkout Way',
              'Test City', 'Test Region', 'US', true, true, 'active'
         from customer_profile
       returning id, customer_user_id
     ), seller_row as (
       insert into sellers (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
       select id, 'Module 10 Seller', 'Module 10 Seller', 'active', 'approved', now() from seller_user
       returning id
     ), store_row as (
       insert into stores (seller_id, slug, name, status, default_currency)
       select id, $3, 'Module 10 Store', 'active', 'USD' from seller_row
       returning id, seller_id
     ), shipping_method as (
       insert into shipping_methods (
         owner_type, seller_id, code, name, pricing_type, base_rate, currency, status
       )
       select 'seller', seller_row.id, $4, 'Module 10 Standard', 'flat', 12.0000, 'USD', 'active'
         from seller_row
       returning id
     ), category_row as (
       insert into categories (slug, name, status, sort_order)
       values ($5, 'Module 10 Category', 'active', 0)
       returning id
     ), product_row as (
       insert into products (
         seller_id, store_id, category_id, slug, name, description,
         status, publication_status, created_by
       )
       select seller_row.id, store_row.id, category_row.id,
              $6, 'Module 10 Product', 'Module 10 Product',
              'active', 'draft', seller_user.id
       from seller_user, seller_row, store_row, category_row
       returning id, seller_id, store_id
     ), variant_row as (
       insert into product_variants (product_id, sku, title, price, currency, status)
       select id, $7, 'Module 10 Variant', 100.0000, 'USD', 'active' from product_row
       returning id
     ), inventory_row as (
       insert into inventory_items (seller_id, store_id, variant_id, on_hand_qty, reserved_qty)
       select product_row.seller_id, product_row.store_id, variant_row.id, 10, 0
       from product_row, variant_row
       returning id
     )
     select customer_profile.user_id as customer_user_id,
            customer_address.id as address_id,
            seller_row.id as seller_id,
            store_row.id as store_id,
            shipping_method.id as shipping_method_id,
            product_row.id as product_id,
            variant_row.id as variant_id,
            inventory_row.id as inventory_item_id
       from customer_profile, customer_address, seller_row, store_row,
            shipping_method, product_row, variant_row, inventory_row`,
    [
      `module10-migration-seller-${suffix}@example.com`,
      `module10-migration-customer-${suffix}@example.com`,
      `module10-migration-store-${suffix}`,
      `MODULE10-${suffix.toUpperCase()}-SHIP`,
      `module10-migration-category-${suffix}`,
      `module10-migration-product-${suffix}`,
      `MODULE10-${suffix.toUpperCase()}-SKU`,
    ],
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.customer_user_id), "Checkout fixture could not create a Customer.");
  assertCondition(Boolean(fixture?.address_id), "Checkout fixture could not create a Customer address.");
  assertCondition(Boolean(fixture?.seller_id), "Checkout fixture could not create a Seller.");
  assertCondition(Boolean(fixture?.store_id), "Checkout fixture could not create a Store.");
  assertCondition(Boolean(fixture?.shipping_method_id), "Checkout fixture could not create a Shipping method.");
  assertCondition(Boolean(fixture?.variant_id), "Checkout fixture could not create a Product variant.");
  assertCondition(Boolean(fixture?.inventory_item_id), "Checkout fixture could not create Inventory.");
  return fixture;
}

/** Verifies the Pass 3 tables, indexes, foreign keys, numeric columns, and local checks exist. */
async function verifyCheckoutSchema() {
  for (const tableName of [
    "checkout_quotes",
    "checkout_quote_lines",
    "checkout_quote_shipping_selections",
    "checkout_attempts",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const indexName of [
    "customer_addresses_id_customer_uq",
    "checkout_quotes_id_customer_uq",
    "checkout_quotes_customer_expiry_idx",
    "checkout_quote_lines_seller_idx",
    "checkout_quote_lines_store_idx",
    "checkout_quote_lines_variant_idx",
    "checkout_quote_shipping_selections_seller_idx",
    "checkout_quote_shipping_selections_method_idx",
    "checkout_attempts_quote_uq",
    "checkout_attempts_customer_idempotency_uq",
    "checkout_attempts_customer_status_idx",
    "checkout_attempts_order_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} index is missing.`);
  }

  assertCondition(
    !(await indexExists("checkout_attempts_id_customer_uq")),
    "Redundant checkout_attempts_id_customer_uq index must be removed in Pass 3.",
  );

  for (const [tableName, constraintName] of [
    ["checkout_quotes", "checkout_quotes_shipping_address_customer_fk"],
    ["checkout_quotes", "checkout_quotes_billing_address_customer_fk"],
    ["checkout_quotes", "checkout_quotes_addresses_present_check"],
    ["checkout_quotes", "checkout_quotes_coupon_code_normalized_check"],
    ["checkout_quotes", "checkout_quotes_state_hash_sha256_check"],
    ["checkout_quote_lines", "checkout_quote_lines_store_seller_fk"],
    ["checkout_quote_lines", "checkout_quote_lines_store_present_check"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_pk"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_quote_id_checkout_quotes_id_fk"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_seller_id_sellers_id_fk"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_store_seller_fk"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_shipping_method_id_shipping_methods_id_fk"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_amount_nonnegative_check"],
    ["checkout_quote_shipping_selections", "checkout_quote_shipping_selections_currency_check"],
    ["checkout_attempts", "checkout_attempts_quote_customer_fk"],
    ["checkout_attempts", "checkout_attempts_idempotency_key_normalized_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  for (const [tableName, columnName] of [
    ["checkout_quotes", "subtotal"],
    ["checkout_quotes", "discount_total"],
    ["checkout_quotes", "tax_total"],
    ["checkout_quotes", "shipping_total"],
    ["checkout_quotes", "grand_total"],
    ["checkout_quote_lines", "unit_price"],
    ["checkout_quote_lines", "discount"],
    ["checkout_quote_lines", "tax"],
    ["checkout_quote_lines", "line_total"],
    ["checkout_quote_shipping_selections", "amount"],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(
      definition?.data_type === "numeric" &&
        definition.numeric_precision === 18 &&
        definition.numeric_scale === 4 &&
        definition.is_nullable === "NO",
      `${tableName}.${columnName} must be required NUMERIC(18,4).`,
    );
  }

  const couponCode = await columnDefinition("checkout_quotes", "coupon_code");
  assertCondition(
    couponCode?.data_type === "character varying" &&
      couponCode.character_maximum_length === 120 &&
      couponCode.is_nullable === "YES",
    "checkout_quotes.coupon_code must be nullable varchar(120).",
  );

  const orderId = await columnDefinition("checkout_attempts", "order_id");
  assertCondition(
    orderId?.data_type === "uuid" && orderId.is_nullable === "YES",
    "checkout_attempts.order_id must remain a nullable UUID until Module 11 exists.",
  );
}

/** Creates one valid Pass 3 quote, line, shipping selection, and attempt used by integrity checks. */
async function createValidCheckoutRows(fixture, keySuffix = "valid") {
  const quoteResult = await pool.query(
    `insert into checkout_quotes (
       customer_user_id, shipping_address_id, billing_address_id, coupon_code,
       currency, subtotal, discount_total, tax_total, shipping_total,
       grand_total, expires_at, state_hash
     )
     values ($1, $2, $2, null, 'USD', 200.0000, 20.0000, 18.0000, 12.0000,
             210.0000, now() + interval '15 minutes', $3)
     returning id`,
    [fixture.customer_user_id, fixture.address_id, "a".repeat(64)],
  );
  const quoteId = quoteResult.rows[0].id;

  await pool.query(
    `insert into checkout_quote_lines (
       quote_id, variant_id, seller_id, store_id, qty, unit_price, discount, tax, line_total
     )
     values ($1, $2, $3, $4, 2, 100.0000, 20.0000, 18.0000, 198.0000)`,
    [quoteId, fixture.variant_id, fixture.seller_id, fixture.store_id],
  );

  await pool.query(
    `insert into checkout_quote_shipping_selections (
       quote_id, seller_id, store_id, shipping_method_id,
       shipping_method_code_snapshot, shipping_method_name_snapshot, amount, currency
     ) values ($1, $2, $3, $4, $5, 'Module 10 Standard', 12.0000, 'USD')`,
    [
      quoteId,
      fixture.seller_id,
      fixture.store_id,
      fixture.shipping_method_id,
      `MODULE10-${keySuffix.toUpperCase()}-SHIP`,
    ],
  );

  const attemptResult = await pool.query(
    `insert into checkout_attempts (
       quote_id, customer_user_id, status, idempotency_key, expires_at
     ) values ($1, $2, 'confirmed', $3, now() + interval '15 minutes')
     returning id`,
    [quoteId, fixture.customer_user_id, `checkout-${keySuffix}`],
  );

  return { quoteId, attemptId: attemptResult.rows[0].id };
}

/** Proves new Pass 3 rows enforce address ownership, store identity, state hash, shipping selection, and one-attempt rules. */
async function verifyCheckoutGuards(fixture) {
  const { quoteId } = await createValidCheckoutRows(fixture);

  await expectDatabaseError(
    `insert into checkout_quotes (
       customer_user_id, currency, subtotal, discount_total, tax_total,
       shipping_total, grand_total, expires_at, state_hash
     ) values ($1, 'USD', 10, 0, 0, 0, 10, now() + interval '5 minutes', $2)`,
    [fixture.customer_user_id, "b".repeat(64)],
    "23514",
    "Every new Checkout quote must persist shipping and billing address IDs.",
  );

  await expectDatabaseError(
    `insert into checkout_quotes (
       customer_user_id, shipping_address_id, billing_address_id, currency,
       subtotal, discount_total, tax_total, shipping_total, grand_total, expires_at, state_hash
     ) values ($1, $2, $2, 'USD', 10, 0, 0, 0, 10, now() + interval '5 minutes', 'not-sha256')`,
    [fixture.customer_user_id, fixture.address_id],
    "23514",
    "Every new Checkout quote state_hash must be lowercase SHA-256 hex.",
  );

  const otherCustomer = await createCheckoutFixture(`other-${Math.random().toString(16).slice(2)}`);
  await expectDatabaseError(
    `insert into checkout_quotes (
       customer_user_id, shipping_address_id, billing_address_id, currency,
       subtotal, discount_total, tax_total, shipping_total, grand_total, expires_at, state_hash
     ) values ($1, $2, $2, 'USD', 10, 0, 0, 0, 10, now() + interval '5 minutes', $3)`,
    [fixture.customer_user_id, otherCustomer.address_id, "c".repeat(64)],
    "23503",
    "Checkout quote addresses must belong to the same customer as the quote.",
  );

  await expectDatabaseError(
    `insert into checkout_quote_lines (
       quote_id, variant_id, seller_id, qty, unit_price, discount, tax, line_total
     ) values ($1, $2, $3, 1, 10, 0, 0, 10)`,
    [quoteId, otherCustomer.variant_id, otherCustomer.seller_id],
    "23514",
    "Every new Checkout quote line must persist its server-derived store ID.",
  );

  await expectDatabaseError(
    `insert into checkout_quote_shipping_selections (
       quote_id, seller_id, store_id, shipping_method_id,
       shipping_method_code_snapshot, shipping_method_name_snapshot, amount, currency
     ) values ($1, $2, $3, $4, 'DUPLICATE', 'Duplicate', 12, 'USD')`,
    [quoteId, fixture.seller_id, fixture.store_id, fixture.shipping_method_id],
    "23505",
    "A Checkout quote may persist only one Shipping selection for each store group.",
  );

  await expectDatabaseError(
    `insert into checkout_attempts (
       quote_id, customer_user_id, status, idempotency_key, expires_at
     ) values ($1, $2, 'confirmed', $3, now() + interval '15 minutes')`,
    [quoteId, fixture.customer_user_id, `different-key-${Math.random()}`],
    "23505",
    "One Checkout quote must create at most one Checkout attempt even with a different idempotency key.",
  );
}

/** Inserts one pre-Pass-3 Checkout snapshot to prove append-only upgrade compatibility. */
async function createLegacyCheckoutRows(fixture) {
  const quoteResult = await pool.query(
    `insert into checkout_quotes (
       customer_user_id, currency, subtotal, discount_total, tax_total,
       shipping_total, grand_total, expires_at, state_hash
     ) values ($1, 'USD', 100, 0, 0, 0, 100, now() + interval '20 minutes', 'legacy-state-hash')
     returning id`,
    [fixture.customer_user_id],
  );
  const quoteId = quoteResult.rows[0].id;

  await pool.query(
    `insert into checkout_quote_lines (
       quote_id, variant_id, seller_id, qty, unit_price, discount, tax, line_total
     ) values ($1, $2, $3, 1, 100, 0, 0, 100)`,
    [quoteId, fixture.variant_id, fixture.seller_id],
  );

  const attemptResult = await pool.query(
    `insert into checkout_attempts (
       quote_id, customer_user_id, status, idempotency_key, expires_at
     ) values ($1, $2, 'pending', 'legacy-checkout-key', now() + interval '20 minutes')
     returning id`,
    [quoteId, fixture.customer_user_id],
  );

  return { quoteId, attemptId: attemptResult.rows[0].id };
}

/** Verifies a clean database can reach the hardened Checkout persistence contract through append-only history. */
async function verifyCleanPath() {
  await resetSchema();
  await applyPreContractMigrations();
  await applyMigration(checkoutContractMigration);
  await verifyCheckoutSchema();

  const fixture = await createCheckoutFixture("clean");
  await verifyCheckoutGuards(fixture);
}

/** Verifies Pass 3 preserves legacy Checkout rows and opaque pre-Checkout reservation attempt identifiers. */
async function verifyUpgradePath() {
  await resetSchema();
  await applyPreContractMigrations();
  const fixture = await createCheckoutFixture("upgrade");

  const legacyAttemptIdResult = await pool.query("select gen_random_uuid() as id");
  const legacyReservationAttemptId = legacyAttemptIdResult.rows[0].id;
  await pool.query(
    `insert into stock_reservations (
       variant_id, customer_user_id, order_attempt_id, qty, status, expires_at, source_key
     ) values ($1, $2, $3, 1, 'reserved', now() + interval '1 hour', 'module10-legacy-reservation')`,
    [fixture.variant_id, fixture.customer_user_id, legacyReservationAttemptId],
  );

  const legacyCheckout = await createLegacyCheckoutRows(fixture);
  const before = await pool.query(
    `select
       (select count(*) from checkout_quotes) as quotes,
       (select count(*) from checkout_quote_lines) as lines,
       (select count(*) from checkout_attempts) as attempts,
       (select state_hash from checkout_quotes where id = $1) as state_hash,
       (select order_attempt_id from stock_reservations where source_key = 'module10-legacy-reservation') as reservation_attempt_id`,
    [legacyCheckout.quoteId],
  );

  await applyMigration(checkoutContractMigration);
  await verifyCheckoutSchema();

  const after = await pool.query(
    `select
       (select count(*) from checkout_quotes) as quotes,
       (select count(*) from checkout_quote_lines) as lines,
       (select count(*) from checkout_attempts) as attempts,
       (select state_hash from checkout_quotes where id = $1) as state_hash,
       (select shipping_address_id from checkout_quotes where id = $1) as shipping_address_id,
       (select store_id from checkout_quote_lines where quote_id = $1) as store_id,
       (select order_attempt_id from stock_reservations where source_key = 'module10-legacy-reservation') as reservation_attempt_id`,
    [legacyCheckout.quoteId],
  );

  assertCondition(after.rows[0]?.quotes === before.rows[0]?.quotes, "Pass 3 changed legacy Checkout quote count.");
  assertCondition(after.rows[0]?.lines === before.rows[0]?.lines, "Pass 3 changed legacy Checkout line count.");
  assertCondition(after.rows[0]?.attempts === before.rows[0]?.attempts, "Pass 3 changed legacy Checkout attempt count.");
  assertCondition(after.rows[0]?.state_hash === "legacy-state-hash", "Pass 3 changed a legacy Checkout state hash.");
  assertCondition(after.rows[0]?.shipping_address_id === null, "Legacy quotes must remain readable without fabricated address choices.");
  assertCondition(after.rows[0]?.store_id === null, "Legacy quote lines must remain readable without fabricated store snapshots.");
  assertCondition(
    after.rows[0]?.reservation_attempt_id === legacyReservationAttemptId,
    "Pass 3 must preserve opaque pre-Checkout reservation attempt identifiers.",
  );

  const newFixture = await createCheckoutFixture("upgrade-new");
  await verifyCheckoutGuards(newFixture);
}

/** Runs clean-schema and supported-upgrade verification for the Pass 3 Checkout persistence contract. */
async function main() {
  try {
    await verifyCleanPath();
    await verifyUpgradePath();
    console.log("Module 10 Checkout migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
