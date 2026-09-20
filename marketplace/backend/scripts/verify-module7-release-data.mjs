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

/** Fails the release gate when one Inventory integrity query returns invalid rows. */
async function requireZero(pool, label, sql) {
  const count = await countRows(pool, sql);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the browser workflow to have produced at least one real Inventory row. */
async function requireAtLeastOne(pool, label, sql) {
  const count = await countRows(pool, sql);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies the database triggers that protect Inventory ownership and immutable movement history. */
async function verifyInventoryTriggers(pool) {
  const result = await pool.query(`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'inventory_items_variant_scope_trigger',
        'stock_movements_append_only_trigger'
      )
  `);
  const names = new Set(result.rows.map((row) => row.tgname));

  for (const required of [
    "inventory_items_variant_scope_trigger",
    "stock_movements_append_only_trigger",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Required Module 7 database trigger is missing: ${required}`);
    }
  }
}

/** Runs post-E2E Inventory invariants without modifying marketplace data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 7 Inventory E2E",
      "SELECT COUNT(*)::int AS count FROM inventory_items",
    );
    await requireAtLeastOne(
      pool,
      "Module 7 stock movement E2E",
      "SELECT COUNT(*)::int AS count FROM stock_movements",
    );

    await requireZero(
      pool,
      "Inventory seller/store ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM inventory_items i
        JOIN stores s ON s.id = i.store_id
        WHERE i.seller_id <> s.seller_id
      `,
    );

    await requireZero(
      pool,
      "Inventory Product-variant ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM inventory_items i
        JOIN product_variants v ON v.id = i.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE i.seller_id <> p.seller_id
           OR i.store_id <> p.store_id
      `,
    );

    await requireZero(
      pool,
      "Inventory quantity bounds",
      `
        SELECT COUNT(*)::int AS count
        FROM inventory_items
        WHERE on_hand_qty < 0
           OR reserved_qty < 0
           OR reserved_qty > on_hand_qty
           OR (reorder_level IS NOT NULL AND reorder_level < 0)
      `,
    );

    await requireZero(
      pool,
      "Inventory active reservation reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM inventory_items i
        LEFT JOIN (
          SELECT variant_id, SUM(qty)::int AS reserved_qty
          FROM stock_reservations
          WHERE status IN ('reserved', 'committed')
          GROUP BY variant_id
        ) r ON r.variant_id = i.variant_id
        WHERE i.reserved_qty <> COALESCE(r.reserved_qty, 0)
      `,
    );

    await requireZero(
      pool,
      "Inventory location/variant uniqueness",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT store_id, variant_id
          FROM inventory_items
          GROUP BY store_id, variant_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Stock movement source uniqueness",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT idempotency_key
          FROM stock_movements
          GROUP BY idempotency_key
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Stock reservation source uniqueness",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_key
          FROM stock_reservations
          GROUP BY source_key
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await verifyInventoryTriggers(pool);
    console.log("Module 7 post-E2E Inventory integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
