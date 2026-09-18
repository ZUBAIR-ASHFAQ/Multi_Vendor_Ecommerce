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

/** Fails the release gate when one Product integrity query returns any invalid rows. */
async function requireZero(pool, label, sql) {
  const count = await countRows(pool, sql);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Verifies the two database triggers that protect immutable history and concurrent SKU uniqueness. */
async function verifyProductTriggers(pool) {
  const result = await pool.query(`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'product_price_history_append_only_trigger',
        'product_variants_seller_store_sku_trigger'
      )
  `);
  const names = new Set(result.rows.map((row) => row.tgname));

  for (const required of [
    "product_price_history_append_only_trigger",
    "product_variants_seller_store_sku_trigger",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Required Module 6 database trigger is missing: ${required}`);
    }
  }
}

/** Runs post-E2E Product invariants without modifying any marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireZero(
      pool,
      "Product seller/store ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM products p
        JOIN stores s ON s.id = p.store_id
        WHERE p.seller_id <> s.seller_id
      `,
    );

    await requireZero(
      pool,
      "Global Product slug uniqueness",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT slug
          FROM products
          GROUP BY slug
          HAVING COUNT(*) > 1
        ) duplicate_slugs
      `,
    );

    await requireZero(
      pool,
      "Seller/store SKU uniqueness",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT p.seller_id, p.store_id, v.sku
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          GROUP BY p.seller_id, p.store_id, v.sku
          HAVING COUNT(*) > 1
        ) duplicate_skus
      `,
    );

    await requireZero(
      pool,
      "Product attribute option ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM product_attribute_values pav
        JOIN attribute_values av ON av.id = pav.value_id
        WHERE pav.value_id IS NOT NULL
          AND pav.attribute_id <> av.attribute_id
      `,
    );

    await requireZero(
      pool,
      "Published Product active-variant invariant",
      `
        SELECT COUNT(*)::int AS count
        FROM products p
        WHERE p.publication_status = 'published'
          AND (
            p.status <> 'active'
            OR NOT EXISTS (
              SELECT 1
              FROM product_variants v
              WHERE v.product_id = p.id
                AND v.status = 'active'
            )
          )
      `,
    );

    await requireZero(
      pool,
      "Product media confirmed-file invariant",
      `
        SELECT COUNT(*)::int AS count
        FROM product_media pm
        JOIN files f ON f.id = pm.file_id
        WHERE f.status <> 'confirmed'
      `,
    );

    await verifyProductTriggers(pool);
    console.log("Module 6 post-E2E Product integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
