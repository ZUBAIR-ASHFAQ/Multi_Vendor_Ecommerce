import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const preModule12Migrations = [
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
];
const module12Migration = "0024_payments_persistence.sql";

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

/** Applies every accepted migration that existed before Module 12 Pass 1. */
async function applyPreModule12Migrations() {
  for (const migration of preModule12Migrations) await applyMigration(migration);
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

/** Creates the minimum valid Customer Order needed to prove Module 12 foreign-key and uniqueness behavior. */
async function createOrderFixture(suffix) {
  const orderId = randomUUID();
  const orderNo = `ORD-${orderId.replaceAll("-", "").toUpperCase()}`;
  const result = await pool.query(
    `with customer_user as (
       insert into users (email, password_hash, display_name, account_type, status)
       values ($1, 'migration-password-hash', 'Module 12 Customer', 'customer', 'active')
       returning id
     ), customer_profile as (
       insert into customer_profiles (user_id, display_name, status)
       select id, 'Module 12 Customer', 'active' from customer_user
       returning user_id
     ), customer_address as (
       insert into customer_addresses (
         customer_user_id, label, recipient_name, phone, line1, city, region,
         country_code, is_default_shipping, is_default_billing, status
       )
       select user_id, 'Home', 'Module 12 Customer', '+1 555 0120', '12 Payments Way',
              'Test City', 'Test Region', 'US', true, true, 'active'
         from customer_profile
       returning id, customer_user_id
     ), quote_row as (
       insert into checkout_quotes (
         customer_user_id, shipping_address_id, billing_address_id, currency,
         subtotal, discount_total, tax_total, shipping_total, grand_total,
         expires_at, state_hash
       )
       select customer_profile.user_id, customer_address.id, customer_address.id, 'USD',
              100.0000, 0.0000, 10.0000, 5.0000, 115.0000,
              now() + interval '30 minutes', repeat('b', 64)
         from customer_profile, customer_address
       returning id, customer_user_id
     ), attempt_row as (
       insert into checkout_attempts (
         quote_id, customer_user_id, status, idempotency_key, expires_at
       )
       select quote_row.id, quote_row.customer_user_id, 'confirmed', $2, now() + interval '30 minutes'
         from quote_row
       returning id, customer_user_id
     ), order_row as (
       insert into orders (
         id, order_no, checkout_attempt_id, customer_user_id, currency,
         subtotal, discount_total, tax_total, shipping_total, grand_total
       )
       select $3, $4, attempt_row.id, attempt_row.customer_user_id, 'USD',
              100.0000, 0.0000, 10.0000, 5.0000, 115.0000
         from attempt_row
       returning id, checkout_attempt_id, customer_user_id
     )
     update checkout_attempts
        set order_id = order_row.id
       from order_row
      where checkout_attempts.id = order_row.checkout_attempt_id
     returning checkout_attempts.order_id as order_id, checkout_attempts.customer_user_id`,
    [
      `module12-migration-customer-${suffix}@example.com`,
      `module12-attempt-${suffix}`,
      orderId,
      orderNo,
    ],
  );

  const fixture = result.rows[0];
  assertCondition(Boolean(fixture?.order_id), "Module 12 fixture could not create Customer Order.");
  return fixture;
}

/** Verifies the three Payment tables, money precision, replay indexes, and Order foreign key. */
async function verifyModule12Schema() {
  for (const tableName of ["payments", "payment_transactions", "payment_webhook_events"]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const [tableName, columnName] of [
    ["payments", "amount_authorized"],
    ["payments", "amount_captured"],
    ["payments", "amount_refunded"],
    ["payment_transactions", "amount"],
  ]) {
    const definition = await columnDefinition(tableName, columnName);
    assertCondition(
      definition?.numeric_precision === 18 && definition?.numeric_scale === 4,
      `${tableName}.${columnName} must be NUMERIC(18,4).`,
    );
  }

  const payloadHash = await columnDefinition("payment_webhook_events", "payload_hash");
  assertCondition(payloadHash?.character_maximum_length === 64, "Webhook payload_hash must be varchar(64).");

  for (const indexName of [
    "payments_order_uq",
    "payments_provider_payment_uq",
    "payments_status_created_idx",
    "payment_transactions_provider_txn_uq",
    "payment_transactions_source_key_uq",
    "payment_transactions_payment_occurred_idx",
    "payment_webhook_events_provider_event_uq",
    "payment_webhook_events_status_received_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} index is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["payments", "payments_order_id_orders_id_fk"],
    ["payments", "payments_amount_refunded_not_over_captured_check"],
    ["payments", "payments_status_check"],
    ["payment_transactions", "payment_transactions_payment_id_payments_id_fk"],
    ["payment_transactions", "payment_transactions_raw_event_id_payment_webhook_events_id_fk"],
    ["payment_webhook_events", "payment_webhook_events_status_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${constraintName} constraint is missing.`,
    );
  }
}

/** Inserts valid Payment history and proves the database blocks duplicate money sources and unsafe totals. */
async function verifyPaymentPersistence(firstOrder, secondOrder) {
  const payment = await pool.query(
    `insert into payments (
       order_id, provider, provider_payment_id, currency,
       amount_authorized, amount_captured, amount_refunded, status, idempotency_key
     ) values ($1, 'stripe', 'pi_module12_primary', 'USD', 115.0000, 115.0000, 0.0000, 'captured', repeat('c', 64))
     returning id`,
    [firstOrder.order_id],
  );
  const paymentId = payment.rows[0]?.id;
  assertCondition(Boolean(paymentId), "Valid Module 12 Payment could not be persisted.");

  const webhook = await pool.query(
    `insert into payment_webhook_events (
       provider, provider_event_id, event_type, payload_hash, status, processed_at
     ) values ('stripe', 'evt_module12_capture', 'payment_intent.succeeded', repeat('d', 64), 'processed', now())
     returning id`,
  );
  const webhookId = webhook.rows[0]?.id;

  await pool.query(
    `insert into payment_transactions (
       payment_id, type, provider_txn_id, amount, status, occurred_at, raw_event_id, source_key
     ) values ($1, 'capture', 'ch_module12_capture', 115.0000, 'succeeded', now(), $2, 'payments:capture:module12')`,
    [paymentId, webhookId],
  );

  await expectDatabaseError(
    `insert into payments (order_id, provider, currency, status)
     values ($1, 'stripe', 'USD', 'pending')`,
    [firstOrder.order_id],
    "23505",
    "One Customer Order must not create two Payment aggregates.",
  );

  await expectDatabaseError(
    `insert into payments (order_id, provider, provider_payment_id, currency, status)
     values ($1, 'stripe', 'pi_module12_primary', 'USD', 'pending')`,
    [secondOrder.order_id],
    "23505",
    "One provider PaymentIntent ID must not belong to two Payment aggregates.",
  );

  await expectDatabaseError(
    `insert into payment_webhook_events (
       provider, provider_event_id, event_type, payload_hash, status
     ) values ('stripe', 'evt_module12_capture', 'payment_intent.succeeded', repeat('e', 64), 'received')`,
    [],
    "23505",
    "A verified provider event ID must be replay-safe.",
  );

  await expectDatabaseError(
    `insert into payment_transactions (
       payment_id, type, provider_txn_id, amount, status, occurred_at, source_key
     ) values ($1, 'capture', 'ch_module12_duplicate', 115.0000, 'succeeded', now(), 'payments:capture:module12')`,
    [paymentId],
    "23505",
    "A Payment transaction source key must be replay-safe.",
  );

  await expectDatabaseError(
    `update payments set amount_refunded = amount_captured + 1 where id = $1`,
    [paymentId],
    "23514",
    "Refunded money must never exceed captured money.",
  );
}

/** Verifies clean migration from Foundation through Module 12 Pass 1. */
async function verifyCleanMigration() {
  await resetSchema();
  await applyPreModule12Migrations();
  await applyMigration(module12Migration);
  await verifyModule12Schema();
}

/** Verifies upgrade from released Module 11 preserves existing Orders and accepts valid Payment persistence. */
async function verifySupportedUpgrade() {
  await resetSchema();
  await applyPreModule12Migrations();
  const firstOrder = await createOrderFixture("upgrade-a");
  const secondOrder = await createOrderFixture("upgrade-b");

  await applyMigration(module12Migration);
  await verifyModule12Schema();

  const preserved = await pool.query(`select id from orders where id = any($1::uuid[])`, [
    [firstOrder.order_id, secondOrder.order_id],
  ]);
  assertCondition(preserved.rowCount === 2, "Module 12 migration must preserve released Module 11 Orders.");

  await verifyPaymentPersistence(firstOrder, secondOrder);
}

try {
  await verifyCleanMigration();
  await verifySupportedUpgrade();
  console.log("Module 12 clean and supported-upgrade migration verification passed.");
} finally {
  await pool.end();
}
