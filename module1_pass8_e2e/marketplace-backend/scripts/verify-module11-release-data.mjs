import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from an Orders release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when one Orders invariant returns invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the real Module 11 browser workflow to have persisted at least one matching row/event. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Runs post-E2E Module 11 reconciliation checks without modifying marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(pool, "Module 11 Customer Order E2E", "SELECT COUNT(*)::int AS count FROM orders");
    await requireAtLeastOne(
      pool,
      "Module 11 multi-seller split E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT order_id
          FROM seller_orders
          GROUP BY order_id
          HAVING COUNT(*) >= 2
        ) multi_seller
      `,
    );
    await requireAtLeastOne(pool, "Module 11 Order Item E2E", "SELECT COUNT(*)::int AS count FROM order_items");
    await requireAtLeastOne(pool, "Module 11 Order address E2E", "SELECT COUNT(*)::int AS count FROM order_addresses");
    await requireAtLeastOne(
      pool,
      "Module 11 Order status-history E2E",
      "SELECT COUNT(*)::int AS count FROM order_status_history",
    );

    for (const eventType of [
      "order.created",
      "seller_order.created",
      "order.payment_confirmed",
      "seller_order.accepted",
      "order.status_changed",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 11 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Checkout attempt to Customer Order one-to-one link",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_attempts attempt
        LEFT JOIN orders order_row ON order_row.checkout_attempt_id = attempt.id
        WHERE attempt.status = 'confirmed'
          AND (attempt.order_id IS NULL OR order_row.id IS NULL OR attempt.order_id <> order_row.id)
      `,
    );

    await requireZero(
      pool,
      "Duplicate Customer Order per Checkout attempt",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT checkout_attempt_id
          FROM orders
          GROUP BY checkout_attempt_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Parent Order to Seller Order aggregate reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM orders parent
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(child.subtotal), 0)::numeric(18,4) AS subtotal,
            COALESCE(SUM(child.discount_total), 0)::numeric(18,4) AS discount_total,
            COALESCE(SUM(child.tax_total), 0)::numeric(18,4) AS tax_total,
            COALESCE(SUM(child.shipping_total), 0)::numeric(18,4) AS shipping_total,
            COALESCE(SUM(child.grand_total), 0)::numeric(18,4) AS grand_total
          FROM seller_orders child
          WHERE child.order_id = parent.id
        ) totals ON TRUE
        WHERE parent.subtotal <> totals.subtotal
           OR parent.discount_total <> totals.discount_total
           OR parent.tax_total <> totals.tax_total
           OR parent.shipping_total <> totals.shipping_total
           OR parent.grand_total <> totals.grand_total
      `,
    );

    await requireZero(
      pool,
      "Seller Order to immutable item aggregate reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM seller_orders seller_order
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(item.unit_price * item.qty), 0)::numeric(18,4) AS subtotal,
            COALESCE(SUM(item.discount_allocated), 0)::numeric(18,4) AS discount_total,
            COALESCE(SUM(item.tax_allocated), 0)::numeric(18,4) AS tax_total
          FROM order_items item
          WHERE item.seller_order_id = seller_order.id
        ) totals ON TRUE
        WHERE seller_order.subtotal <> totals.subtotal
           OR seller_order.discount_total <> totals.discount_total
           OR seller_order.tax_total <> totals.tax_total
           OR seller_order.grand_total <>
              seller_order.subtotal - seller_order.discount_total + seller_order.tax_total + seller_order.shipping_total
      `,
    );

    await requireZero(
      pool,
      "Order address snapshot coverage",
      `
        SELECT COUNT(*)::int AS count
        FROM orders order_row
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE address.type = 'shipping') AS shipping_count,
            COUNT(*) FILTER (WHERE address.type = 'billing') AS billing_count
          FROM order_addresses address
          WHERE address.order_id = order_row.id
        ) coverage ON TRUE
        WHERE coverage.shipping_count <> 1 OR coverage.billing_count <> 1
      `,
    );

    await requireZero(
      pool,
      "Seller Order seller/store ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM seller_orders seller_order
        JOIN stores store ON store.id = seller_order.store_id
        WHERE store.seller_id <> seller_order.seller_id
      `,
    );

    await requireZero(
      pool,
      "Order Item seller/store/Product ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        JOIN seller_orders seller_order ON seller_order.id = item.seller_order_id
        JOIN products product ON product.id = item.product_id
        JOIN product_variants variant ON variant.id = item.variant_id
        WHERE item.order_id <> seller_order.order_id
           OR variant.product_id <> product.id
           OR product.seller_id <> seller_order.seller_id
           OR product.store_id <> seller_order.store_id
      `,
    );

    await requireZero(
      pool,
      "Order Item Inventory reservation identity",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        JOIN orders order_row ON order_row.id = item.order_id
        JOIN stock_reservations reservation ON reservation.id = item.inventory_reservation_id
        WHERE reservation.order_attempt_id <> order_row.checkout_attempt_id
           OR reservation.variant_id <> item.variant_id
           OR reservation.customer_user_id <> order_row.customer_user_id
           OR reservation.qty <> item.qty
      `,
    );

    await requireZero(
      pool,
      "Order Item cancellation accounting",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        WHERE item.cancelled_qty < 0
           OR item.cancelled_qty > item.qty
           OR (item.cancelled_qty = 0 AND item.status <> 'active')
           OR (item.cancelled_qty > 0 AND item.cancelled_qty < item.qty AND item.status <> 'partially_cancelled')
           OR (item.cancelled_qty = item.qty AND item.status <> 'cancelled')
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 11 immutable Product snapshot proof",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        JOIN products product ON product.id = item.product_id
        JOIN product_variants variant ON variant.id = item.variant_id
        WHERE item.name_snapshot <> product.name
           OR item.sku_snapshot <> variant.sku
           OR item.unit_price <> variant.price
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 11 partial cancellation release proof",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        JOIN stock_reservations reservation ON reservation.id = item.inventory_reservation_id
        WHERE item.cancelled_qty > 0
          AND reservation.released_qty >= item.cancelled_qty
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 11 captured/processing lifecycle proof",
      `
        SELECT COUNT(*)::int AS count
        FROM orders order_row
        WHERE order_row.payment_status = 'captured'
          AND order_row.order_status = 'processing'
          AND EXISTS (
            SELECT 1
            FROM seller_orders seller_order
            WHERE seller_order.order_id = order_row.id
              AND seller_order.status = 'processing'
          )
      `,
    );

    await requireZero(
      pool,
      "Duplicate replay-safe payment-confirmed source",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_type, source_key
          FROM order_status_history
          WHERE source_type IS NOT NULL AND source_key IS NOT NULL
          GROUP BY source_type, source_key
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    console.log("Module 11 post-E2E Orders integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
