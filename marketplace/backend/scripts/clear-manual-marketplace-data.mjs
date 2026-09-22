import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const CONFIRMATION = "DELETE_LOCAL_MARKETPLACE_DATA";
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(resolve(backendDirectory, ".env"));
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to clear marketplace data while NODE_ENV=production.");
}

if (process.env.CLEAR_MARKETPLACE_DATA_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Set CLEAR_MARKETPLACE_DATA_CONFIRM=${CONFIRMATION} to confirm this destructive local-development cleanup.`,
  );
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required before clearing marketplace data.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!localHosts.has(parsedDatabaseUrl.hostname)) {
  throw new Error(
    `Refusing to clear non-local PostgreSQL host ${parsedDatabaseUrl.hostname}.`,
  );
}

const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "");
if (!databaseName || ["postgres", "template0", "template1"].includes(databaseName)) {
  throw new Error(`Refusing to clear protected PostgreSQL database ${databaseName || "<empty>"}.`);
}

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`
    CREATE TEMP TABLE cleanup_target_users ON COMMIT DROP AS
    SELECT id
    FROM users
    WHERE account_type IN ('customer', 'seller');

    CREATE TEMP TABLE cleanup_target_sellers ON COMMIT DROP AS
    SELECT id
    FROM sellers;

    CREATE TEMP TABLE cleanup_target_files ON COMMIT DROP AS
    SELECT id
    FROM files
    WHERE owner_user_id IN (SELECT id FROM cleanup_target_users)
       OR purpose IN ('product_media', 'seller_verification', 'store_asset');
  `);

  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM cleanup_target_users) AS users,
      (SELECT count(*)::int FROM cleanup_target_sellers) AS sellers,
      (SELECT count(*)::int FROM cleanup_target_files) AS files;
  `);

  await client.query(`
    TRUNCATE TABLE
      audit_logs,
      cart_items,
      carts,
      checkout_attempts,
      checkout_quote_lines,
      checkout_quote_shipping_selections,
      checkout_quotes,
      commission_entries,
      commission_rule_snapshots,
      coupon_redemptions,
      customer_addresses,
      customer_profiles,
      dispute_notes,
      file_links,
      idempotency_keys,
      inventory_items,
      notification_deliveries,
      notifications,
      order_addresses,
      order_items,
      order_status_history,
      orders,
      outbox_events,
      payment_transactions,
      payment_webhook_events,
      payments,
      payout_accounts,
      payout_allocations,
      payouts,
      product_attribute_values,
      product_media,
      product_price_history,
      product_search_documents,
      product_variants,
      products,
      rating_aggregates,
      refunds,
      report_runs,
      return_items,
      return_requests,
      return_status_history,
      review_helpful_votes,
      review_moderation_history,
      reviews,
      search_reindex_runs,
      seller_orders,
      seller_wallet_entries,
      seller_wallets,
      shipment_items,
      shipment_status_history,
      shipments,
      stock_movements,
      stock_reservations,
      wishlist_items,
      wishlists
    RESTART IDENTITY;
  `);

  await client.query(`
    DELETE FROM promotion_scopes
    WHERE promotion_id IN (
      SELECT id FROM promotions WHERE seller_id IN (SELECT id FROM cleanup_target_sellers)
    )
       OR scope_type = 'product';

    DELETE FROM coupons
    WHERE promotion_id IN (
      SELECT id FROM promotions WHERE seller_id IN (SELECT id FROM cleanup_target_sellers)
    );

    DELETE FROM promotions
    WHERE seller_id IN (SELECT id FROM cleanup_target_sellers);

    DELETE FROM shipping_methods
    WHERE seller_id IN (SELECT id FROM cleanup_target_sellers);

    DELETE FROM commission_rules
    WHERE scope_type IN ('seller', 'product');

    DELETE FROM user_roles
    WHERE seller_id IN (SELECT id FROM cleanup_target_sellers)
       OR user_id IN (SELECT id FROM cleanup_target_users);

    DELETE FROM files
    WHERE id IN (SELECT id FROM cleanup_target_files);

    DELETE FROM seller_staff;
    DELETE FROM stores;
    DELETE FROM sellers;
    DELETE FROM seller_applications;

    DELETE FROM users
    WHERE id IN (SELECT id FROM cleanup_target_users);
  `);

  await client.query("COMMIT");

  const row = counts.rows[0] ?? { users: 0, sellers: 0, files: 0 };
  console.log(
    `Cleared local seller/customer data: ${row.users} user account(s), ${row.sellers} seller record(s), and ${row.files} seller/customer file record(s). Platform-admin accounts, RBAC, platform settings, catalog taxonomy, platform shipping methods, report definitions, notification templates, and search synonyms were preserved.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
