import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Module 13 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Shipping invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the live Module 13 Playwright workflow to have produced persisted proof rows. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies immutable Shipment allocation, Inventory issue, lifecycle, idempotency, and Order fulfillment truth after Playwright. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 13 delivered browser Shipment",
      `
        SELECT COUNT(*)::int AS count
        FROM shipments
        WHERE tracking_no LIKE 'M13-E2E-%'
          AND status = 'delivered'
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 13 concurrent partial-Shipment browser proof",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT seller_order.order_id
          FROM shipments shipment
          JOIN seller_orders seller_order ON seller_order.id = shipment.seller_order_id
          JOIN orders order_row ON order_row.id = seller_order.order_id
          WHERE shipment.tracking_no LIKE 'M13-CONCURRENT-%'
            AND shipment.status IN ('shipped', 'delivered')
            AND order_row.fulfillment_status = 'fulfilled'
          GROUP BY seller_order.order_id
          HAVING COUNT(*) >= 2
        ) proof
      `,
    );

    for (const scope of ["shipping.create", "shipping.mark-shipped", "shipping.mark-delivered"]) {
      await requireAtLeastOne(
        pool,
        `Module 13 completed ${scope} idempotency record`,
        `
          SELECT COUNT(*)::int AS count
          FROM idempotency_keys
          WHERE scope = $1
            AND status = 'completed'
        `,
        [scope],
      );
    }

    for (const eventType of [
      "shipment.created",
      "shipment.tracking_updated",
      "shipment.shipped",
      "shipment.delivered",
    ]) {
      await requireAtLeastOne(
        pool,
        `Module 13 ${eventType} outbox event`,
        "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = $1",
        [eventType],
      );
    }

    await requireZero(
      pool,
      "Shipment allocation over commercial remaining quantity",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            item.id,
            item.qty - item.cancelled_qty AS commercial_remaining,
            COALESCE(SUM(shipment_item.quantity), 0)::int AS allocated_quantity
          FROM order_items item
          LEFT JOIN shipment_items shipment_item ON shipment_item.order_item_id = item.id
          GROUP BY item.id, item.qty, item.cancelled_qty
          HAVING COALESCE(SUM(shipment_item.quantity), 0) > item.qty - item.cancelled_qty
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Shipment Item Seller Order ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM shipment_items shipment_item
        JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
        JOIN order_items item ON item.id = shipment_item.order_item_id
        WHERE item.seller_order_id <> shipment.seller_order_id
      `,
    );

    await requireZero(
      pool,
      "Created Shipment physical issue isolation",
      `
        SELECT COUNT(*)::int AS count
        FROM shipments shipment
        JOIN stock_movements movement
          ON movement.source_type = 'shipment'
         AND movement.source_id = shipment.id
         AND movement.movement_type = 'ship'
        WHERE shipment.status = 'created'
      `,
    );

    await requireZero(
      pool,
      "Shipped Shipment Inventory movement reconciliation",
      `
        WITH shipment_allocations AS (
          SELECT
            shipment_item.shipment_id,
            SUM(shipment_item.quantity)::int AS allocated_quantity,
            COUNT(*)::int AS item_count
          FROM shipment_items shipment_item
          GROUP BY shipment_item.shipment_id
        ),
        shipment_issues AS (
          SELECT
            movement.source_id AS shipment_id,
            (-SUM(movement.quantity_delta))::int AS issued_quantity,
            COUNT(*)::int AS movement_count
          FROM stock_movements movement
          WHERE movement.source_type = 'shipment'
            AND movement.movement_type = 'ship'
          GROUP BY movement.source_id
        )
        SELECT COUNT(*)::int AS count
        FROM shipments shipment
        LEFT JOIN shipment_allocations allocation ON allocation.shipment_id = shipment.id
        LEFT JOIN shipment_issues issue ON issue.shipment_id = shipment.id
        WHERE shipment.status IN ('shipped', 'delivered')
          AND (
            COALESCE(allocation.allocated_quantity, 0) <> COALESCE(issue.issued_quantity, 0)
            OR COALESCE(allocation.item_count, 0) <> COALESCE(issue.movement_count, 0)
          )
      `,
    );

    await requireZero(
      pool,
      "Order Item reservation shipment-consumption reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM order_items item
        JOIN stock_reservations reservation ON reservation.id = item.inventory_reservation_id
        LEFT JOIN (
          SELECT shipment_item.order_item_id, SUM(shipment_item.quantity)::int AS shipped_quantity
          FROM shipment_items shipment_item
          JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
          WHERE shipment.status IN ('shipped', 'delivered')
          GROUP BY shipment_item.order_item_id
        ) shipped ON shipped.order_item_id = item.id
        WHERE reservation.consumed_qty <> COALESCE(shipped.shipped_quantity, 0)
      `,
    );

    await requireZero(
      pool,
      "Shipment lifecycle history reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            shipment.id,
            shipment.status,
            COUNT(history.id) FILTER (WHERE history.status = 'created') AS created_count,
            COUNT(history.id) FILTER (WHERE history.status = 'shipped') AS shipped_count,
            COUNT(history.id) FILTER (WHERE history.status = 'delivered') AS delivered_count
          FROM shipments shipment
          LEFT JOIN shipment_status_history history ON history.shipment_id = shipment.id
          GROUP BY shipment.id, shipment.status
          HAVING COUNT(history.id) FILTER (WHERE history.status = 'created') <> 1
             OR COUNT(history.id) FILTER (WHERE history.status = 'shipped') <>
                CASE WHEN shipment.status IN ('shipped', 'delivered') THEN 1 ELSE 0 END
             OR COUNT(history.id) FILTER (WHERE history.status = 'delivered') <>
                CASE WHEN shipment.status = 'delivered' THEN 1 ELSE 0 END
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Shipment lifecycle audit seller scope",
      `
        SELECT COUNT(*)::int AS count
        FROM audit_logs audit
        JOIN shipments shipment ON shipment.id::text = audit.resource_id
        JOIN seller_orders seller_order ON seller_order.id = shipment.seller_order_id
        WHERE audit.resource_type = 'shipment'
          AND audit.action IN (
            'shipment.created',
            'shipment.tracking_updated',
            'shipment.shipped',
            'shipment.delivered'
          )
          AND audit.seller_id IS DISTINCT FROM seller_order.seller_id
      `,
    );

    await requireZero(
      pool,
      "Create/ship/deliver audit exactly-once evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT shipment.id, expected.action, COUNT(audit.id)::int AS event_count
          FROM shipments shipment
          CROSS JOIN LATERAL (
            VALUES
              ('shipment.created'::text, true),
              ('shipment.shipped'::text, shipment.status IN ('shipped', 'delivered')),
              ('shipment.delivered'::text, shipment.status = 'delivered')
          ) AS expected(action, required)
          LEFT JOIN audit_logs audit
            ON audit.resource_type = 'shipment'
           AND audit.resource_id = shipment.id::text
           AND audit.action = expected.action
          GROUP BY shipment.id, expected.action, expected.required
          HAVING COUNT(audit.id) <> CASE WHEN expected.required THEN 1 ELSE 0 END
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Create/ship/deliver outbox exactly-once evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT shipment.id, expected.event_type, COUNT(event.id)::int AS event_count
          FROM shipments shipment
          CROSS JOIN LATERAL (
            VALUES
              ('shipment.created'::text, true),
              ('shipment.shipped'::text, shipment.status IN ('shipped', 'delivered')),
              ('shipment.delivered'::text, shipment.status = 'delivered')
          ) AS expected(event_type, required)
          LEFT JOIN outbox_events event
            ON event.aggregate_type = 'shipment'
           AND event.aggregate_id = shipment.id::text
           AND event.event_type = expected.event_type
          GROUP BY shipment.id, expected.event_type, expected.required
          HAVING COUNT(event.id) <> CASE WHEN expected.required THEN 1 ELSE 0 END
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Tracking audit/outbox parity",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            shipment.id,
            COUNT(DISTINCT audit.id)::int AS audit_count,
            COUNT(DISTINCT event.id)::int AS outbox_count
          FROM shipments shipment
          LEFT JOIN audit_logs audit
            ON audit.resource_type = 'shipment'
           AND audit.resource_id = shipment.id::text
           AND audit.action = 'shipment.tracking_updated'
          LEFT JOIN outbox_events event
            ON event.aggregate_type = 'shipment'
           AND event.aggregate_id = shipment.id::text
           AND event.event_type = 'shipment.tracking_updated'
          GROUP BY shipment.id
          HAVING COUNT(DISTINCT audit.id) <> COUNT(DISTINCT event.id)
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Parent Order fulfillment reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            order_row.id,
            order_row.fulfillment_status,
            COALESCE(SUM(item.qty - item.cancelled_qty), 0)::int AS fulfillable_quantity,
            COALESCE(SUM(shipped.shipped_quantity), 0)::int AS shipped_quantity
          FROM orders order_row
          JOIN order_items item ON item.order_id = order_row.id
          LEFT JOIN (
            SELECT shipment_item.order_item_id, SUM(shipment_item.quantity)::int AS shipped_quantity
            FROM shipment_items shipment_item
            JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
            WHERE shipment.status IN ('shipped', 'delivered')
            GROUP BY shipment_item.order_item_id
          ) shipped ON shipped.order_item_id = item.id
          GROUP BY order_row.id, order_row.fulfillment_status
        ) totals
        WHERE totals.fulfillment_status <>
          CASE
            WHEN totals.shipped_quantity = 0 THEN 'unfulfilled'
            WHEN totals.shipped_quantity < totals.fulfillable_quantity THEN 'partially_fulfilled'
            ELSE 'fulfilled'
          END
      `,
    );

    await requireZero(
      pool,
      "Module 13 E2E replay duplicate Shipping evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT shipment.id
          FROM shipments shipment
          WHERE shipment.tracking_no LIKE 'M13-E2E-%'
            AND (
              (SELECT COUNT(*) FROM shipment_status_history history WHERE history.shipment_id = shipment.id AND history.status = 'created') <> 1
              OR (SELECT COUNT(*) FROM shipment_status_history history WHERE history.shipment_id = shipment.id AND history.status = 'shipped') <> 1
              OR (SELECT COUNT(*) FROM shipment_status_history history WHERE history.shipment_id = shipment.id AND history.status = 'delivered') <> 1
              OR (SELECT COUNT(*) FROM stock_movements movement WHERE movement.source_type = 'shipment' AND movement.source_id = shipment.id AND movement.movement_type = 'ship') <> 1
              OR (SELECT COUNT(*) FROM audit_logs audit WHERE audit.resource_type = 'shipment' AND audit.resource_id = shipment.id::text AND audit.action = 'shipment.created') <> 1
              OR (SELECT COUNT(*) FROM audit_logs audit WHERE audit.resource_type = 'shipment' AND audit.resource_id = shipment.id::text AND audit.action = 'shipment.shipped') <> 1
              OR (SELECT COUNT(*) FROM audit_logs audit WHERE audit.resource_type = 'shipment' AND audit.resource_id = shipment.id::text AND audit.action = 'shipment.delivered') <> 1
              OR (SELECT COUNT(*) FROM outbox_events event WHERE event.aggregate_type = 'shipment' AND event.aggregate_id = shipment.id::text AND event.event_type = 'shipment.created') <> 1
              OR (SELECT COUNT(*) FROM outbox_events event WHERE event.aggregate_type = 'shipment' AND event.aggregate_id = shipment.id::text AND event.event_type = 'shipment.shipped') <> 1
              OR (SELECT COUNT(*) FROM outbox_events event WHERE event.aggregate_type = 'shipment' AND event.aggregate_id = shipment.id::text AND event.event_type = 'shipment.delivered') <> 1
            )
        ) invalid
      `,
    );

    console.log("Module 13 post-E2E Shipping & Fulfillment reconciliation passed.");
  } finally {
    await pool.end();
  }
}

await main();
