import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a release-integrity query. */
async function countRows(pool, sql) {
  const result = await pool.query(sql);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when one Module 8 integrity query returns invalid rows. */
async function requireZero(pool, label, sql) {
  const count = await countRows(pool, sql);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the browser workflow to leave at least one real row for a Module 8 aggregate. */
async function requireAtLeastOne(pool, label, sql) {
  const count = await countRows(pool, sql);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Runs post-E2E Cart/Wishlist relational checks without changing marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 8 Cart E2E",
      "SELECT COUNT(*)::int AS count FROM carts",
    );
    await requireAtLeastOne(
      pool,
      "Module 8 Cart item E2E",
      "SELECT COUNT(*)::int AS count FROM cart_items",
    );
    await requireAtLeastOne(
      pool,
      "Module 8 Wishlist E2E",
      "SELECT COUNT(*)::int AS count FROM wishlists",
    );

    await requireZero(
      pool,
      "One Cart per customer",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT customer_user_id
          FROM carts
          GROUP BY customer_user_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Duplicate Cart variant lines",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT cart_id, variant_id
          FROM cart_items
          GROUP BY cart_id, variant_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Invalid Cart quantities",
      "SELECT COUNT(*)::int AS count FROM cart_items WHERE quantity <= 0",
    );

    await requireZero(
      pool,
      "Invalid Cart currencies",
      `
        SELECT COUNT(*)::int AS count
        FROM carts
        WHERE currency <> upper(btrim(currency))
           OR currency !~ '^[A-Z]{3}$'
      `,
    );

    await requireZero(
      pool,
      "Multiple default Wishlists per customer",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT customer_user_id
          FROM wishlists
          WHERE is_default = true
          GROUP BY customer_user_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Wishlist variant/Product mismatch",
      `
        SELECT COUNT(*)::int AS count
        FROM wishlist_items wi
        JOIN product_variants pv ON pv.id = wi.variant_id
        WHERE wi.variant_id IS NOT NULL
          AND pv.product_id <> wi.product_id
      `,
    );

    await requireZero(
      pool,
      "Duplicate variant-bound Wishlist entries",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT wishlist_id, product_id, variant_id
          FROM wishlist_items
          WHERE variant_id IS NOT NULL
          GROUP BY wishlist_id, product_id, variant_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    console.log("Module 8 post-E2E Cart/Wishlist integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
