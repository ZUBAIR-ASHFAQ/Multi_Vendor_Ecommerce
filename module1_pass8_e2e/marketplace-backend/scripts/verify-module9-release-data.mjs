import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a Module 9 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when one Module 9 invariant query returns invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the browser workflow to leave at least one real Module 9 row or event. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Runs post-E2E Promotions/Coupons integrity checks without modifying marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 9 promotion E2E",
      "SELECT COUNT(*)::int AS count FROM promotions",
    );
    await requireAtLeastOne(
      pool,
      "Module 9 promotion scope E2E",
      "SELECT COUNT(*)::int AS count FROM promotion_scopes",
    );
    await requireAtLeastOne(
      pool,
      "Module 9 coupon E2E",
      "SELECT COUNT(*)::int AS count FROM coupons",
    );

    for (const eventType of [
      "promotion.created",
      "promotion.activated",
      "promotion.deactivated",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 9 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    for (const action of [
      "promotion.created",
      "promotion.activated",
      "promotion.deactivated",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 9 ${action} audit record`,
        "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = $1",
        [action],
      );
    }

    await requireZero(
      pool,
      "Promotion ownership/funding consistency",
      `
        SELECT COUNT(*)::int AS count
        FROM promotions
        WHERE (owner_type = 'platform' AND seller_id IS NOT NULL)
           OR (owner_type = 'seller' AND seller_id IS NULL)
           OR (owner_type = 'platform' AND funding_type <> 'platform')
           OR (owner_type = 'seller' AND funding_type <> 'seller')
      `,
    );

    await requireZero(
      pool,
      "Promotion date/value integrity",
      `
        SELECT COUNT(*)::int AS count
        FROM promotions
        WHERE start_at >= end_at
           OR value <= 0
           OR (type = 'percentage' AND value > 100)
      `,
    );

    await requireZero(
      pool,
      "Duplicate Promotion scopes",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT promotion_id, scope_type, scope_id
          FROM promotion_scopes
          GROUP BY promotion_id, scope_type, scope_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Non-normalized Coupon codes",
      `
        SELECT COUNT(*)::int AS count
        FROM coupons
        WHERE code <> upper(btrim(code)) OR length(code) = 0
      `,
    );

    await requireZero(
      pool,
      "Invalid Coupon usage limits",
      `
        SELECT COUNT(*)::int AS count
        FROM coupons
        WHERE (max_uses IS NOT NULL AND max_uses <= 0)
           OR (max_uses_per_customer IS NOT NULL AND max_uses_per_customer <= 0)
      `,
    );

    await requireZero(
      pool,
      "Duplicate Coupon redemption order identities",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT coupon_id, order_id
          FROM coupon_redemptions
          GROUP BY coupon_id, order_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    console.log("Module 9 post-E2E Promotions/Coupons integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
