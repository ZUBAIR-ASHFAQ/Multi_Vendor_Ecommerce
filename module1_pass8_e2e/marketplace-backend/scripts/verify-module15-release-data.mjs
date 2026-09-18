import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Module 15 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Reviews invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the live Module 15 Playwright workflow to have produced persisted proof rows. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies verified-purchase Reviews, moderation, ratings, Search sync, audit, outbox, and Helpful truth. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 15 E2E verified Review",
      `
        SELECT COUNT(*)::int AS count
        FROM reviews
        WHERE title = 'Excellent verified purchase'
          AND verified_purchase = true
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 15 Helpful vote",
      `
        SELECT COUNT(*)::int AS count
        FROM review_helpful_votes vote
        JOIN reviews review ON review.id = vote.review_id
        WHERE review.title = 'Excellent verified purchase'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 15 hide moderation history",
      `
        SELECT COUNT(*)::int AS count
        FROM review_moderation_history history
        JOIN reviews review ON review.id = history.review_id
        WHERE review.title = 'Excellent verified purchase'
          AND history.action = 'hide'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 15 publish moderation history",
      `
        SELECT COUNT(*)::int AS count
        FROM review_moderation_history history
        JOIN reviews review ON review.id = history.review_id
        WHERE review.title = 'Excellent verified purchase'
          AND history.action = 'publish'
      `,
    );

    for (const action of ["review.created", "review.hidden", "review.published"]) {
      await requireAtLeastOne(
        pool,
        `Module 15 audit action ${action}`,
        "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = $1",
        [action],
      );
    }

    for (const eventType of [
      "review.created",
      "review.hidden",
      "review.published",
      "rating.aggregate_updated",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 15 outbox event ${eventType}`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Module 15 unverified persisted Review",
      "SELECT COUNT(*)::int AS count FROM reviews WHERE verified_purchase <> true",
    );

    await requireZero(
      pool,
      "Module 15 duplicate Order Item Review",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT order_item_id
          FROM reviews
          GROUP BY order_item_id
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Module 15 Review ownership snapshot reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM reviews review
        JOIN order_items item ON item.id = review.order_item_id
        JOIN seller_orders seller_order ON seller_order.id = item.seller_order_id
        JOIN orders customer_order ON customer_order.id = item.order_id
        WHERE review.customer_user_id <> customer_order.customer_user_id
           OR review.product_id <> item.product_id
           OR review.seller_id <> seller_order.seller_id
           OR review.store_id <> seller_order.store_id
      `,
    );

    await requireZero(
      pool,
      "Module 15 full-delivery eligibility reconciliation",
      `
        WITH delivered AS (
          SELECT
            shipment_item.order_item_id,
            SUM(shipment_item.quantity)::int AS delivered_quantity
          FROM shipment_items shipment_item
          JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
          WHERE shipment.status = 'delivered'
          GROUP BY shipment_item.order_item_id
        )
        SELECT COUNT(*)::int AS count
        FROM reviews review
        JOIN order_items item ON item.id = review.order_item_id
        LEFT JOIN delivered ON delivered.order_item_id = item.id
        WHERE COALESCE(delivered.delivered_quantity, 0) < (item.qty - item.cancelled_qty)
      `,
    );

    await requireZero(
      pool,
      "Module 15 Product aggregate reconciliation",
      `
        WITH calculated AS (
          SELECT
            product_id AS entity_id,
            ROUND(AVG(rating)::numeric, 2)::numeric(4,2) AS rating_avg,
            COUNT(*)::int AS rating_count
          FROM reviews
          WHERE status = 'published'
          GROUP BY product_id
        ), entities AS (
          SELECT entity_id FROM rating_aggregates WHERE entity_type = 'product'
          UNION
          SELECT product_id FROM reviews
        )
        SELECT COUNT(*)::int AS count
        FROM entities entity
        LEFT JOIN calculated calc ON calc.entity_id = entity.entity_id
        LEFT JOIN rating_aggregates aggregate
          ON aggregate.entity_type = 'product'
         AND aggregate.entity_id = entity.entity_id
        WHERE aggregate.entity_id IS NULL
           OR aggregate.rating_count <> COALESCE(calc.rating_count, 0)
           OR aggregate.rating_avg <> COALESCE(calc.rating_avg, 0)
      `,
    );

    await requireZero(
      pool,
      "Module 15 Seller aggregate reconciliation",
      `
        WITH calculated AS (
          SELECT
            seller_id AS entity_id,
            ROUND(AVG(rating)::numeric, 2)::numeric(4,2) AS rating_avg,
            COUNT(*)::int AS rating_count
          FROM reviews
          WHERE status = 'published'
          GROUP BY seller_id
        ), entities AS (
          SELECT entity_id FROM rating_aggregates WHERE entity_type = 'seller'
          UNION
          SELECT seller_id FROM reviews
        )
        SELECT COUNT(*)::int AS count
        FROM entities entity
        LEFT JOIN calculated calc ON calc.entity_id = entity.entity_id
        LEFT JOIN rating_aggregates aggregate
          ON aggregate.entity_type = 'seller'
         AND aggregate.entity_id = entity.entity_id
        WHERE aggregate.entity_id IS NULL
           OR aggregate.rating_count <> COALESCE(calc.rating_count, 0)
           OR aggregate.rating_avg <> COALESCE(calc.rating_avg, 0)
      `,
    );

    await requireZero(
      pool,
      "Module 15 Search rating synchronization",
      `
        SELECT COUNT(*)::int AS count
        FROM rating_aggregates aggregate
        JOIN product_search_documents document
          ON document.product_id = aggregate.entity_id
        WHERE aggregate.entity_type = 'product'
          AND (
            document.rating_count <> aggregate.rating_count
            OR document.rating_avg <> aggregate.rating_avg
          )
      `,
    );

    await requireZero(
      pool,
      "Module 15 published Review timestamp state",
      `
        SELECT COUNT(*)::int AS count
        FROM reviews
        WHERE status = 'published' AND published_at IS NULL
      `,
    );

    console.log("Module 15 post-E2E Reviews/Ratings reconciliation verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
