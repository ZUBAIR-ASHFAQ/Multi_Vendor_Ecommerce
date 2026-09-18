import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Module 16 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Commission invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the Playwright Commission workflow to have persisted at least one matching row. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies immutable Commission snapshots, entries, idempotency, and full-refund reversal after Playwright. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 16 active 10 percent E2E rule",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_rules
        WHERE status = 'active'
          AND priority = 100
          AND rate_percent = 10.000000
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 16 updated future 16 percent E2E rule",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_rules
        WHERE status = 'active'
          AND priority = 200
          AND rate_percent = 16.000000
          AND start_at > now()
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 16 immutable 10 percent Order Item snapshot",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_rule_snapshots snapshot
        JOIN order_items item ON item.id = snapshot.order_item_id
        JOIN seller_orders seller_order ON seller_order.id = item.seller_order_id
        JOIN payments payment ON payment.order_id = seller_order.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND snapshot.rate_percent = 10.000000
          AND snapshot.basis_json->>'version' = '1'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 16 immutable sale entry E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries entry
        JOIN seller_orders seller_order ON seller_order.id = entry.seller_order_id
        JOIN payments payment ON payment.order_id = seller_order.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND entry.type = 'sale'
          AND entry.source_key LIKE 'commission:sale:%'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 16 append-only refund entry E2E",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries entry
        JOIN seller_orders seller_order ON seller_order.id = entry.seller_order_id
        JOIN payments payment ON payment.order_id = seller_order.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND entry.type = 'refund'
          AND entry.source_key LIKE 'commission:refund:%'
      `,
    );

    for (const eventType of ["commission.rule_created", "commission.posted", "commission.adjusted"]) {
      await requireAtLeastOne(
        pool,
        `Module 16 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    for (const scope of ["commissions.order-settle", "commissions.refund-adjust"]) {
      await requireAtLeastOne(
        pool,
        `Module 16 completed ${scope} idempotency record`,
        `
          SELECT COUNT(*)::int AS count
          FROM idempotency_keys
          WHERE scope = $1
            AND status = 'completed'
            AND response_status = 200
        `,
        [scope],
      );
    }

    await requireZero(
      pool,
      "Duplicate Commission entry source keys",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_key
          FROM commission_entries
          GROUP BY source_key
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Duplicate Commission snapshots per Order Item",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT order_item_id
          FROM commission_rule_snapshots
          GROUP BY order_item_id
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Commission entries missing immutable rule snapshots",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries entry
        LEFT JOIN commission_rule_snapshots snapshot ON snapshot.order_item_id = entry.order_item_id
        WHERE entry.type IN ('sale', 'refund')
          AND snapshot.id IS NULL
      `,
    );

    await requireZero(
      pool,
      "Module 16 E2E settlement/reversal exactly-once counts",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            entry.order_item_id,
            COUNT(*) FILTER (WHERE entry.type = 'sale') AS sale_count,
            COUNT(*) FILTER (WHERE entry.type = 'refund') AS refund_count
          FROM commission_entries entry
          JOIN seller_orders seller_order ON seller_order.id = entry.seller_order_id
          JOIN payments payment ON payment.order_id = seller_order.order_id
          WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          GROUP BY entry.order_item_id
          HAVING COUNT(*) FILTER (WHERE entry.type = 'sale') <> 1
             OR COUNT(*) FILTER (WHERE entry.type = 'refund') <> 1
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Module 16 full-refund reversal economics",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries sale
        JOIN commission_entries refund
          ON refund.order_item_id = sale.order_item_id
         AND refund.type = 'refund'
        JOIN seller_orders seller_order ON seller_order.id = sale.seller_order_id
        JOIN payments payment ON payment.order_id = seller_order.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND sale.type = 'sale'
          AND (
            refund.gross_amount <> -sale.gross_amount
            OR refund.commission_amount <> -sale.commission_amount
            OR refund.seller_net_amount <> -sale.seller_net_amount
            OR refund.currency <> sale.currency
            OR refund.seller_id <> sale.seller_id
            OR refund.seller_order_id <> sale.seller_order_id
          )
      `,
    );

    await requireZero(
      pool,
      "Module 16 snapshot historical-rate drift",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_rule_snapshots snapshot
        JOIN commission_entries sale
          ON sale.order_item_id = snapshot.order_item_id
         AND sale.type = 'sale'
        JOIN seller_orders seller_order ON seller_order.id = sale.seller_order_id
        JOIN payments payment ON payment.order_id = seller_order.order_id
        WHERE payment.provider_payment_id LIKE 'pi_e2e_%'
          AND snapshot.rate_percent <> 10.000000
      `,
    );

    console.log("Module 16 post-E2E Commission integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
