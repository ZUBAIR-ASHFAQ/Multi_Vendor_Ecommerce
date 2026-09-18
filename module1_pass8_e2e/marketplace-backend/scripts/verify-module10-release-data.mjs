import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a Checkout release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when one Checkout invariant returns invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the real browser workflow to have persisted at least one row/event. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Runs post-E2E Checkout invariants without modifying marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 10 authoritative quote E2E",
      "SELECT COUNT(*)::int AS count FROM checkout_quotes",
    );
    await requireAtLeastOne(
      pool,
      "Module 10 confirmed attempt E2E",
      "SELECT COUNT(*)::int AS count FROM checkout_attempts WHERE status = 'confirmed'",
    );
    await requireAtLeastOne(
      pool,
      "Module 10 quote-line E2E",
      "SELECT COUNT(*)::int AS count FROM checkout_quote_lines",
    );
    await requireAtLeastOne(
      pool,
      "Module 10 Shipping-selection E2E",
      "SELECT COUNT(*)::int AS count FROM checkout_quote_shipping_selections",
    );

    for (const eventType of ["checkout.quoted", "checkout.confirmed"]) {
      await requireAtLeastOne(
        pool,
        `Module 10 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Checkout quote address ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_quotes q
        LEFT JOIN customer_addresses shipping
          ON shipping.id = q.shipping_address_id
         AND shipping.customer_user_id = q.customer_user_id
        LEFT JOIN customer_addresses billing
          ON billing.id = q.billing_address_id
         AND billing.customer_user_id = q.customer_user_id
        WHERE shipping.id IS NULL OR billing.id IS NULL
      `,
    );

    await requireZero(
      pool,
      "Checkout quote aggregate reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_quotes q
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(line.unit_price * line.qty), 0)::numeric(18,4) AS subtotal,
            COALESCE(SUM(line.discount), 0)::numeric(18,4) AS discount_total,
            COALESCE(SUM(line.tax), 0)::numeric(18,4) AS tax_total
          FROM checkout_quote_lines line
          WHERE line.quote_id = q.id
        ) lines ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(selection.amount), 0)::numeric(18,4) AS shipping_total
          FROM checkout_quote_shipping_selections selection
          WHERE selection.quote_id = q.id
        ) shipping ON TRUE
        WHERE q.subtotal <> lines.subtotal
           OR q.discount_total <> lines.discount_total
           OR q.tax_total <> lines.tax_total
           OR q.shipping_total <> shipping.shipping_total
           OR q.grand_total <> q.subtotal - q.discount_total + q.tax_total + q.shipping_total
      `,
    );

    await requireZero(
      pool,
      "Checkout line seller/store ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_quote_lines line
        JOIN product_variants variant ON variant.id = line.variant_id
        JOIN products product ON product.id = variant.product_id
        WHERE line.seller_id <> product.seller_id
           OR line.store_id <> product.store_id
      `,
    );

    await requireZero(
      pool,
      "Checkout Shipping selection seller/store coverage",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT line.quote_id, line.store_id, line.seller_id
          FROM checkout_quote_lines line
          GROUP BY line.quote_id, line.store_id, line.seller_id
        ) groups
        LEFT JOIN checkout_quote_shipping_selections selection
          ON selection.quote_id = groups.quote_id
         AND selection.store_id = groups.store_id
         AND selection.seller_id = groups.seller_id
        WHERE selection.quote_id IS NULL
      `,
    );

    await requireZero(
      pool,
      "Checkout Shipping selection orphan groups",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_quote_shipping_selections selection
        WHERE NOT EXISTS (
          SELECT 1
          FROM checkout_quote_lines line
          WHERE line.quote_id = selection.quote_id
            AND line.store_id = selection.store_id
            AND line.seller_id = selection.seller_id
        )
      `,
    );

    await requireZero(
      pool,
      "Checkout attempt status domain",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_attempts
        WHERE status NOT IN ('confirmed', 'expired', 'failed')
      `,
    );

    await requireZero(
      pool,
      "Checkout confirmed reservation coverage",
      `
        SELECT COUNT(*)::int AS count
        FROM checkout_attempts attempt
        JOIN checkout_quote_lines line ON line.quote_id = attempt.quote_id
        LEFT JOIN stock_reservations reservation
          ON reservation.order_attempt_id = attempt.id
         AND reservation.variant_id = line.variant_id
        WHERE attempt.status = 'confirmed'
          AND (
            reservation.id IS NULL
            OR reservation.customer_user_id <> attempt.customer_user_id
            OR reservation.qty <> line.qty
            OR reservation.status NOT IN ('reserved', 'committed')
            OR reservation.expires_at <> attempt.expires_at
          )
      `,
    );

    await requireZero(
      pool,
      "Checkout duplicate attempt per quote",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT quote_id
          FROM checkout_attempts
          GROUP BY quote_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Checkout duplicate customer idempotency keys",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT customer_user_id, idempotency_key
          FROM checkout_attempts
          GROUP BY customer_user_id, idempotency_key
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    console.log("Module 10 post-E2E Checkout integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
