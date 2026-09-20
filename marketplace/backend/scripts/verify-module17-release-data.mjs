import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Module 17 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Wallet/Payout invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the Module 17 Playwright workflow to have produced durable database evidence. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies Wallet, Commission, Shipping, Return/refund, Payout, audit, outbox, and idempotency reconciliation. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 17 delivered Commission sale source",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries commission
        JOIN shipment_items shipment_item ON shipment_item.order_item_id = commission.order_item_id
        JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
        JOIN seller_wallet_entries wallet_entry
          ON wallet_entry.source_type = 'commission'
         AND wallet_entry.source_id = commission.id
        WHERE commission.type = 'sale'
          AND shipment.status = 'delivered'
          AND shipment.delivered_at IS NOT NULL
          AND wallet_entry.type = 'commission_credit'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 17 pending-to-available settlement evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM seller_wallet_entries pending_debit
        JOIN seller_wallet_entries available_credit
          ON available_credit.source_id = pending_debit.source_id
         AND available_credit.seller_id = pending_debit.seller_id
         AND available_credit.currency = pending_debit.currency
        WHERE pending_debit.type = 'availability_transfer'
          AND pending_debit.balance_bucket = 'pending'
          AND pending_debit.amount < 0
          AND available_credit.type = 'availability_transfer'
          AND available_credit.balance_bucket = 'available'
          AND available_credit.amount = -pending_debit.amount
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 17 provider-paid Payout",
      `
        SELECT COUNT(*)::int AS count
        FROM payouts
        WHERE status = 'paid'
          AND provider_ref LIKE 'e2e-payout-%'
          AND processed_at IS NOT NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 17 authoritative provider failure",
      `
        SELECT COUNT(*)::int AS count
        FROM payouts payout
        WHERE payout.status = 'failed'
          AND EXISTS (
            SELECT 1
            FROM seller_wallet_entries entry
            WHERE entry.source_type = 'payout'
              AND entry.source_id = payout.id
              AND entry.source_key = 'payout:' || payout.id::text || ':release:held-debit'
          )
          AND EXISTS (
            SELECT 1
            FROM seller_wallet_entries entry
            WHERE entry.source_type = 'payout'
              AND entry.source_id = payout.id
              AND entry.source_key = 'payout:' || payout.id::text || ':release:available-credit'
          )
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 17 unknown-then-paid reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM payouts payout
        JOIN payout_accounts account ON account.id = payout.account_id
        WHERE account.provider_account_ref LIKE 'unknown_then_paid:%'
          AND payout.status = 'paid'
          AND payout.provider_ref = 'e2e-payout-' || payout.id::text
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 17 post-payout refund Wallet adjustment",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries refund_commission
        JOIN seller_wallet_entries wallet_adjustment
          ON wallet_adjustment.source_type = 'commission'
         AND wallet_adjustment.source_id = refund_commission.id
        JOIN seller_wallets wallet
          ON wallet.seller_id = refund_commission.seller_id
         AND wallet.currency = refund_commission.currency
        WHERE refund_commission.type = 'refund'
          AND wallet_adjustment.type = 'commission_adjustment'
          AND wallet.negative_balance < 0
          AND EXISTS (
            SELECT 1
            FROM payouts payout
            WHERE payout.seller_id = refund_commission.seller_id
              AND payout.currency = refund_commission.currency
              AND payout.status = 'paid'
              AND payout.provider_ref LIKE 'e2e-payout-%'
          )
      `,
    );

    for (const eventType of [
      "wallet.credited",
      "wallet.available",
      "wallet.adjusted",
      "payout.requested",
      "payout.paid",
      "payout.failed",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 17 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    for (const action of [
      "payout_account.created",
      "payout.requested",
      "payout.approved",
      "payout.send_requested",
      "payout.paid",
      "payout.failed",
      "wallet.settled",
      "wallet.adjusted",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 17 ${action} audit evidence`,
        "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = $1",
        [action],
      );
    }

    for (const scopePattern of [
      "wallet-payouts.payout-request:%",
      "wallet-payouts.payout-approve:%",
      "wallet-payouts.payout-send:%",
      "wallet-payouts.wallet-settle",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 17 completed idempotency scope ${scopePattern}`,
        `
          SELECT COUNT(*)::int AS count
          FROM idempotency_keys
          WHERE scope LIKE $1
            AND status = 'completed'
        `,
        [scopePattern],
      );
    }

    await requireZero(
      pool,
      "Module 17 Wallet snapshot-to-ledger reconciliation",
      `
        WITH ledger AS (
          SELECT
            seller_id,
            currency,
            COALESCE(SUM(amount) FILTER (WHERE balance_bucket = 'pending'), 0) AS pending_balance,
            COALESCE(SUM(amount) FILTER (WHERE balance_bucket = 'available'), 0) AS available_balance,
            COALESCE(SUM(amount) FILTER (WHERE balance_bucket = 'held'), 0) AS held_balance,
            COALESCE(SUM(amount) FILTER (WHERE balance_bucket = 'negative'), 0) AS negative_balance
          FROM seller_wallet_entries
          GROUP BY seller_id, currency
        )
        SELECT COUNT(*)::int AS count
        FROM seller_wallets wallet
        LEFT JOIN ledger
          ON ledger.seller_id = wallet.seller_id
         AND ledger.currency = wallet.currency
        WHERE wallet.pending_balance <> COALESCE(ledger.pending_balance, 0)
           OR wallet.available_balance <> COALESCE(ledger.available_balance, 0)
           OR wallet.held_balance <> COALESCE(ledger.held_balance, 0)
           OR wallet.negative_balance <> COALESCE(ledger.negative_balance, 0)
      `,
    );

    await requireZero(
      pool,
      "Module 17 duplicate immutable Wallet source keys",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_key
          FROM seller_wallet_entries
          GROUP BY source_key
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Module 17 reserved Payout allocation totals",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT payout.id, payout.amount, COALESCE(SUM(allocation.amount), 0) AS allocated
          FROM payouts payout
          LEFT JOIN payout_allocations allocation ON allocation.payout_id = payout.id
          WHERE payout.status IN ('approved', 'processing', 'paid', 'failed')
          GROUP BY payout.id, payout.amount
          HAVING COALESCE(SUM(allocation.amount), 0) <> payout.amount
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Module 17 paid Payout held-history finalization",
      `
        SELECT COUNT(*)::int AS count
        FROM payouts payout
        WHERE payout.status = 'paid'
          AND (
            payout.provider_ref IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM seller_wallet_entries entry
              WHERE entry.source_id = payout.id
                AND entry.source_key = 'payout:' || payout.id::text || ':reserve:held-credit'
                AND entry.amount = payout.amount
            )
            OR NOT EXISTS (
              SELECT 1
              FROM seller_wallet_entries entry
              WHERE entry.source_id = payout.id
                AND entry.source_key = 'payout:' || payout.id::text || ':paid:held-debit'
                AND entry.amount = -payout.amount
            )
          )
      `,
    );

    await requireZero(
      pool,
      "Module 17 terminal Payout status/provider uncertainty",
      `
        SELECT COUNT(*)::int AS count
        FROM payouts
        WHERE status = 'processing'
          AND account_id IN (
            SELECT id
            FROM payout_accounts
            WHERE provider_type = 'e2e'
          )
      `,
    );

    console.log("Module 17 post-E2E Wallet/Payout reconciliation verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
