import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Payments release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Payments invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the browser/provider workflow to have persisted at least one matching row. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) {
    throw new Error(`${label} did not produce any persisted rows.`);
  }
}

/** Verifies the final Module 12 browser/provider workflow without mutating marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 12 provider-test PaymentIntent E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM payments
        WHERE provider = 'stripe'
          AND provider_payment_id LIKE 'pi_e2e_%'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 12 processed signed Stripe webhook E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM payment_webhook_events
        WHERE provider = 'stripe'
          AND provider_event_id LIKE 'evt_e2e_%'
          AND event_type = 'payment_intent.succeeded'
          AND status = 'processed'
          AND processed_at IS NOT NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 12 successful capture transaction E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM payment_transactions transaction_row
        JOIN payments payment ON payment.id = transaction_row.payment_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND transaction_row.type = 'capture'
          AND transaction_row.status = 'succeeded'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 12 successful refund transaction E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM payment_transactions transaction_row
        JOIN payments payment ON payment.id = transaction_row.payment_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND transaction_row.type = 'refund'
          AND transaction_row.status = 'succeeded'
          AND transaction_row.provider_txn_id LIKE 're_e2e_%'
      `,
    );

    for (const eventType of ["payment.intent_created", "payment.captured", "payment.refunded"]) {
      await requireAtLeastOne(
        pool,
        `Module 12 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Payment to Order amount/currency reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM payments payment
        JOIN orders order_row ON order_row.id = payment.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND (
            payment.currency <> order_row.currency
            OR payment.amount_captured <> order_row.grand_total
            OR order_row.payment_status <> 'captured'
            OR order_row.order_status <> 'processing'
          )
      `,
    );

    await requireZero(
      pool,
      "Payment aggregate capture/refund reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM payments payment
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(transaction_row.amount) FILTER (
              WHERE transaction_row.type = 'capture'
                AND transaction_row.status = 'succeeded'
            ), 0)::numeric(18,4) AS captured,
            COALESCE(SUM(transaction_row.amount) FILTER (
              WHERE transaction_row.type = 'refund'
                AND transaction_row.status = 'succeeded'
            ), 0)::numeric(18,4) AS refunded
          FROM payment_transactions transaction_row
          WHERE transaction_row.payment_id = payment.id
        ) transaction_totals ON TRUE
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND (
            payment.amount_captured <> transaction_totals.captured
            OR payment.amount_refunded <> transaction_totals.refunded
            OR payment.amount_refunded > payment.amount_captured
            OR (
              payment.amount_refunded > 0
              AND payment.amount_refunded < payment.amount_captured
              AND payment.status <> 'partially_refunded'
            )
            OR (
              payment.amount_refunded = payment.amount_captured
              AND payment.amount_captured > 0
              AND payment.status <> 'refunded'
            )
          )
      `,
    );

    await requireZero(
      pool,
      "Duplicate provider webhook identities",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT provider, provider_event_id
          FROM payment_webhook_events
          GROUP BY provider, provider_event_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Duplicate provider transaction identities",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT provider_txn_id
          FROM payment_transactions
          WHERE provider_txn_id IS NOT NULL
          GROUP BY provider_txn_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Duplicate Payment transaction source keys",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_key
          FROM payment_transactions
          WHERE source_key IS NOT NULL
          GROUP BY source_key
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Duplicate signed capture side effects",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT transaction_row.payment_id
          FROM payment_transactions transaction_row
          JOIN payments payment ON payment.id = transaction_row.payment_id
          WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
            AND transaction_row.type = 'capture'
            AND transaction_row.status = 'succeeded'
          GROUP BY transaction_row.payment_id
          HAVING COUNT(*) <> 1
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Webhook terminal timestamp/error consistency",
      `
        SELECT COUNT(*)::int AS count
        FROM payment_webhook_events
        WHERE (status IN ('processed', 'ignored', 'failed') AND processed_at IS NULL)
           OR (status IN ('received', 'processing') AND processed_at IS NOT NULL)
           OR (status = 'failed' AND error_code IS NULL)
           OR (status IN ('processed', 'ignored') AND error_code IS NOT NULL)
      `,
    );

    console.log("Module 12 post-E2E Payments integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
