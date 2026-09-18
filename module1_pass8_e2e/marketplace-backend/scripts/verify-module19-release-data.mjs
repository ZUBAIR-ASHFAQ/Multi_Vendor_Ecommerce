import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when one Search integrity query returns invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) {
    throw new Error(`${label} failed with ${count} invalid row group(s).`);
  }
}

/** Requires the browser workflow to have produced at least one real row/event. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies PostgreSQL Search primitives and indexes required by the default Module 19 implementation. */
async function verifySearchDatabasePrimitives(pool) {
  const extension = await pool.query(
    "select count(*)::int as count from pg_extension where extname = 'pg_trgm'",
  );
  if (Number(extension.rows[0]?.count ?? 0) !== 1) {
    throw new Error("Required Module 19 pg_trgm extension is missing.");
  }

  const indexes = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'product_search_documents_fts_idx',
        'product_search_documents_trgm_idx',
        'product_search_documents_attributes_idx',
        'search_reindex_runs_active_scope_uq'
      )
  `);
  const names = new Set(indexes.rows.map((row) => row.indexname));
  for (const required of [
    "product_search_documents_fts_idx",
    "product_search_documents_trgm_idx",
    "product_search_documents_attributes_idx",
    "search_reindex_runs_active_scope_uq",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Required Module 19 database index is missing: ${required}`);
    }
  }
}

/** Verifies the Search read model itself contains no private ownership/lifecycle columns. */
async function verifySearchDocumentPrivacyShape(pool) {
  const forbidden = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_search_documents'
      AND column_name IN (
        'seller_id',
        'seller_status',
        'publication_status',
        'created_by',
        'actor_user_id',
        'customer_user_id'
      )
  `);
  if (forbidden.rowCount) {
    throw new Error(
      `Search document exposes forbidden private column(s): ${forbidden.rows
        .map((row) => row.column_name)
        .join(", ")}`,
    );
  }
}

/** Runs post-E2E Search invariants without modifying marketplace source or derived data. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 19 Search document E2E",
      "SELECT COUNT(*)::int AS count FROM product_search_documents",
    );
    await requireAtLeastOne(
      pool,
      "Module 19 completed reindex E2E",
      "SELECT COUNT(*)::int AS count FROM search_reindex_runs WHERE status = 'completed'",
    );

    for (const eventType of [
      "search.document_updated",
      "search.reindex_started",
      "search.reindex_completed",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 19 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Search duplicate Product documents",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT product_id
          FROM product_search_documents
          GROUP BY product_id
          HAVING COUNT(*) > 1
        ) duplicates
      `,
    );

    await requireZero(
      pool,
      "Search stale public visibility",
      `
        SELECT COUNT(*)::int AS count
        FROM product_search_documents d
        LEFT JOIN products p ON p.id = d.product_id
        LEFT JOIN stores st ON st.id = p.store_id
        LEFT JOIN sellers s ON s.id = p.seller_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.id IS NULL
           OR p.status <> 'active'
           OR p.publication_status <> 'published'
           OR st.status <> 'active'
           OR s.status <> 'active'
           OR s.approval_status <> 'approved'
           OR c.status <> 'active'
           OR (p.brand_id IS NOT NULL AND (b.id IS NULL OR b.status <> 'active'))
      `,
    );

    await requireZero(
      pool,
      "Search source category/brand identity",
      `
        SELECT COUNT(*)::int AS count
        FROM product_search_documents d
        JOIN products p ON p.id = d.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE d.category_id <> p.category_id
           OR d.brand_id IS DISTINCT FROM p.brand_id
           OR (p.brand_id IS NULL AND d.brand IS NOT NULL)
           OR (p.brand_id IS NOT NULL AND d.brand IS DISTINCT FROM b.name)
      `,
    );

    await requireZero(
      pool,
      "Search source price range reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM product_search_documents d
        JOIN LATERAL (
          SELECT MIN(v.price) AS min_price, MAX(v.price) AS max_price
          FROM product_variants v
          WHERE v.product_id = d.product_id
            AND v.status = 'active'
        ) prices ON TRUE
        WHERE prices.min_price IS NULL
           OR d.min_price <> prices.min_price
           OR d.max_price <> prices.max_price
      `,
    );

    await requireZero(
      pool,
      "Search Inventory availability reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM product_search_documents d
        WHERE d.in_stock IS DISTINCT FROM EXISTS (
          SELECT 1
          FROM product_variants v
          JOIN inventory_items i ON i.variant_id = v.id
          WHERE v.product_id = d.product_id
            AND v.status = 'active'
            AND (i.on_hand_qty - i.reserved_qty) > 0
        )
      `,
    );

    await requireZero(
      pool,
      "Search pre-Module-15 rating default",
      `
        SELECT COUNT(*)::int AS count
        FROM product_search_documents
        WHERE rating_avg <> 0 OR rating_count <> 0
      `,
    );

    await requireZero(
      pool,
      "Search active reindex leak",
      `
        SELECT COUNT(*)::int AS count
        FROM search_reindex_runs
        WHERE status IN ('queued', 'running')
      `,
    );

    await requireZero(
      pool,
      "Search reindex terminal-state timestamps",
      `
        SELECT COUNT(*)::int AS count
        FROM search_reindex_runs
        WHERE status IN ('completed', 'failed')
          AND (started_at IS NULL OR completed_at IS NULL)
      `,
    );

    await verifySearchDatabasePrimitives(pool);
    await verifySearchDocumentPrivacyShape(pool);
    console.log("Module 19 post-E2E Search integrity verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
