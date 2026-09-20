import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

/** Reads one scalar count from a read-only Module 14 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Returns/refunds invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the live Module 14 Playwright workflow to have produced persisted proof rows. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Verifies Return allocation, refund money, restock, Commission, audit/outbox, and replay truth after Playwright. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 14 completed Return refunds",
      `
        SELECT COUNT(*)::int AS count
        FROM refunds refund
        JOIN return_requests request ON request.id = refund.return_request_id
        WHERE request.status = 'closed'
          AND refund.status = 'completed'
          AND refund.provider_ref IS NOT NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 14 physical restock path",
      `
        SELECT COUNT(*)::int AS count
        FROM return_items item
        JOIN return_requests request ON request.id = item.return_request_id
        WHERE request.status = 'closed'
          AND item.resolution = 'refund_restock'
          AND item.restock_qty > 0
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 14 refund-without-restock path",
      `
        SELECT COUNT(*)::int AS count
        FROM return_items item
        JOIN return_requests request ON request.id = item.return_request_id
        WHERE request.status = 'closed'
          AND item.resolution = 'refund_no_restock'
          AND item.restock_qty = 0
      `,
    );

    await requireZero(
      pool,
      "Delivered Return allocation reconciliation",
      `
        WITH delivered AS (
          SELECT shipment_item.order_item_id, SUM(shipment_item.quantity)::int AS delivered_quantity
          FROM shipment_items shipment_item
          JOIN shipments shipment ON shipment.id = shipment_item.shipment_id
          WHERE shipment.status = 'delivered'
          GROUP BY shipment_item.order_item_id
        ), reserved AS (
          SELECT item.order_item_id, SUM(item.quantity)::int AS return_quantity
          FROM return_items item
          JOIN return_requests request ON request.id = item.return_request_id
          WHERE request.status <> 'rejected'
          GROUP BY item.order_item_id
        )
        SELECT COUNT(*)::int AS count
        FROM reserved
        LEFT JOIN delivered ON delivered.order_item_id = reserved.order_item_id
        WHERE reserved.return_quantity > COALESCE(delivered.delivered_quantity, 0)
      `,
    );

    await requireZero(
      pool,
      "Return item cumulative refund money reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            item.order_item_id,
            SUM(item.refund_amount)::numeric(18,4) AS refunded_amount,
            MAX(order_item.line_total)::numeric(18,4) AS line_total
          FROM return_items item
          JOIN return_requests request ON request.id = item.return_request_id
          JOIN order_items order_item ON order_item.id = item.order_item_id
          WHERE request.status <> 'rejected'
          GROUP BY item.order_item_id
          HAVING SUM(item.refund_amount) > MAX(order_item.line_total)
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Business Refund equals persisted Return Item refund allocation",
      `
        SELECT COUNT(*)::int AS count
        FROM refunds refund
        JOIN return_requests request ON request.id = refund.return_request_id
        LEFT JOIN (
          SELECT return_request_id, SUM(refund_amount)::numeric(18,4) AS item_refund_amount
          FROM return_items
          GROUP BY return_request_id
        ) item_totals ON item_totals.return_request_id = request.id
        WHERE refund.status = 'completed'
          AND refund.amount <> COALESCE(item_totals.item_refund_amount, 0)
      `,
    );

    await requireZero(
      pool,
      "Closed Return exactly-one completed business Refund",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT request.id, COUNT(refund.id) FILTER (WHERE refund.status = 'completed')::int AS completed_count
          FROM return_requests request
          LEFT JOIN refunds refund ON refund.return_request_id = request.id
          WHERE request.status = 'closed'
          GROUP BY request.id
          HAVING COUNT(refund.id) FILTER (WHERE refund.status = 'completed') <> 1
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Completed Refund provider transaction reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM refunds refund
        JOIN payments payment ON payment.id = refund.payment_id
        LEFT JOIN payment_transactions transaction
          ON transaction.source_key = 'return:' || refund.return_request_id::text || ':refund:' || refund.id::text
         AND transaction.type = 'refund'
         AND transaction.status = 'succeeded'
        WHERE refund.status = 'completed'
          AND (
            refund.order_id <> payment.order_id
            OR refund.currency <> payment.currency
            OR refund.amount > payment.amount_captured
            OR transaction.id IS NULL
            OR transaction.payment_id <> refund.payment_id
            OR transaction.amount <> refund.amount
            OR transaction.provider_txn_id IS DISTINCT FROM refund.provider_ref
          )
      `,
    );

    await requireZero(
      pool,
      "Payment aggregate refunded balance reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM payments payment
        WHERE EXISTS (SELECT 1 FROM refunds refund WHERE refund.payment_id = payment.id)
          AND payment.amount_refunded <>
            COALESCE((
              SELECT SUM(transaction.amount)::numeric(18,4)
              FROM payment_transactions transaction
              WHERE transaction.payment_id = payment.id
                AND transaction.type = 'refund'
                AND transaction.status = 'succeeded'
            ), 0)
      `,
    );

    await requireZero(
      pool,
      "Return restock exactly-once reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            item.id,
            item.return_request_id,
            item.restock_qty,
            COUNT(movement.id)::int AS movement_count,
            COALESCE(SUM(movement.quantity_delta), 0)::int AS movement_quantity
          FROM return_items item
          LEFT JOIN stock_movements movement
            ON movement.source_type = 'return'
           AND movement.source_id = item.id
           AND movement.movement_type = 'restock'
          GROUP BY item.id, item.return_request_id, item.restock_qty
          HAVING
            (item.restock_qty > 0 AND (
              COUNT(movement.id) <> 1
              OR COALESCE(SUM(movement.quantity_delta), 0)::int <> item.restock_qty
            ))
            OR (item.restock_qty = 0 AND COUNT(movement.id) <> 0)
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Return restock deterministic source identity",
      `
        SELECT COUNT(*)::int AS count
        FROM return_items item
        JOIN stock_movements movement
          ON movement.source_type = 'return'
         AND movement.source_id = item.id
         AND movement.movement_type = 'restock'
        WHERE movement.idempotency_key <>
          'return:' || item.return_request_id::text || ':item:' || item.id::text || ':restock'
      `,
    );

    await requireZero(
      pool,
      "Commission sale/refund append-only reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            item.order_item_id,
            COUNT(DISTINCT sale.id)::int AS sale_count,
            COUNT(DISTINCT refund_entry.id)::int AS refund_entry_count,
            COUNT(DISTINCT item.return_request_id)::int AS refunded_return_count
          FROM return_items item
          JOIN return_requests request ON request.id = item.return_request_id
          LEFT JOIN commission_entries sale
            ON sale.order_item_id = item.order_item_id
           AND sale.type = 'sale'
          LEFT JOIN commission_entries refund_entry
            ON refund_entry.order_item_id = item.order_item_id
           AND refund_entry.type = 'refund'
          WHERE request.status = 'closed'
            AND item.refund_amount > 0
          GROUP BY item.order_item_id
          HAVING COUNT(DISTINCT sale.id) <> 1
             OR COUNT(DISTINCT refund_entry.id) <> COUNT(DISTINCT item.return_request_id)
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Commission refund sign and immutable sale preservation",
      `
        SELECT COUNT(*)::int AS count
        FROM commission_entries entry
        WHERE entry.order_item_id IN (
          SELECT DISTINCT item.order_item_id
          FROM return_items item
          JOIN return_requests request ON request.id = item.return_request_id
          WHERE request.status = 'closed'
        )
          AND (
            (entry.type = 'sale' AND (
              entry.gross_amount <= 0 OR entry.commission_amount < 0 OR entry.seller_net_amount < 0
            ))
            OR (entry.type = 'refund' AND (
              entry.gross_amount > 0 OR entry.commission_amount > 0 OR entry.seller_net_amount > 0
            ))
          )
      `,
    );

    await requireZero(
      pool,
      "Return lifecycle history reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            request.id,
            request.status,
            request.approved_at,
            COUNT(history.id) FILTER (WHERE history.to_status = 'requested')::int AS requested_count,
            COUNT(history.id) FILTER (WHERE history.to_status = 'approved')::int AS approved_count,
            COUNT(history.id) FILTER (WHERE history.to_status = 'rejected')::int AS rejected_count,
            COUNT(history.id) FILTER (WHERE history.to_status = 'received')::int AS received_count,
            COUNT(history.id) FILTER (WHERE history.to_status = 'closed')::int AS closed_count
          FROM return_requests request
          LEFT JOIN return_status_history history ON history.return_request_id = request.id
          GROUP BY request.id, request.status, request.approved_at
          HAVING COUNT(history.id) FILTER (WHERE history.to_status = 'requested') <> 1
             OR COUNT(history.id) FILTER (WHERE history.to_status = 'approved') <>
                CASE WHEN request.approved_at IS NOT NULL THEN 1 ELSE 0 END
             OR COUNT(history.id) FILTER (WHERE history.to_status = 'rejected') <>
                CASE WHEN request.status = 'rejected' THEN 1 ELSE 0 END
             OR COUNT(history.id) FILTER (WHERE history.to_status = 'closed') <>
                CASE WHEN request.status = 'closed' THEN 1 ELSE 0 END
             OR COUNT(history.id) FILTER (WHERE history.to_status = 'received') > 1
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Return lifecycle audit/outbox exactly-once evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT request.id, expected.event_name, expected.required,
            COUNT(DISTINCT audit.id)::int AS audit_count,
            COUNT(DISTINCT event.id)::int AS outbox_count
          FROM return_requests request
          CROSS JOIN LATERAL (
            VALUES
              ('return.requested'::text, true),
              ('return.approved'::text, request.approved_at IS NOT NULL),
              ('return.rejected'::text, request.status = 'rejected'),
              ('return.received'::text, EXISTS (
                SELECT 1 FROM return_status_history h
                WHERE h.return_request_id = request.id AND h.to_status = 'received'
              )),
              ('return.closed'::text, request.status = 'closed')
          ) AS expected(event_name, required)
          LEFT JOIN audit_logs audit
            ON audit.resource_type = 'return_request'
           AND audit.resource_id = request.id::text
           AND audit.action = expected.event_name
          LEFT JOIN outbox_events event
            ON event.aggregate_type = 'return_request'
           AND event.aggregate_id = request.id::text
           AND event.event_type = expected.event_name
          GROUP BY request.id, expected.event_name, expected.required
          HAVING COUNT(DISTINCT audit.id) <> CASE WHEN expected.required THEN 1 ELSE 0 END
             OR COUNT(DISTINCT event.id) <> CASE WHEN expected.required THEN 1 ELSE 0 END
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Refund audit/outbox exactly-once evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT refund.id,
            COUNT(DISTINCT requested_audit.id)::int AS requested_audit_count,
            COUNT(DISTINCT completed_audit.id)::int AS completed_audit_count,
            COUNT(DISTINCT requested_event.id)::int AS requested_event_count,
            COUNT(DISTINCT completed_event.id)::int AS completed_event_count
          FROM refunds refund
          LEFT JOIN audit_logs requested_audit
            ON requested_audit.resource_type = 'refund'
           AND requested_audit.resource_id = refund.id::text
           AND requested_audit.action = 'refund.requested'
          LEFT JOIN audit_logs completed_audit
            ON completed_audit.resource_type = 'refund'
           AND completed_audit.resource_id = refund.id::text
           AND completed_audit.action = 'refund.completed'
          LEFT JOIN outbox_events requested_event
            ON requested_event.aggregate_type = 'refund'
           AND requested_event.aggregate_id = refund.id::text
           AND requested_event.event_type = 'refund.requested'
          LEFT JOIN outbox_events completed_event
            ON completed_event.aggregate_type = 'refund'
           AND completed_event.aggregate_id = refund.id::text
           AND completed_event.event_type = 'refund.completed'
          WHERE refund.status = 'completed'
          GROUP BY refund.id
          HAVING COUNT(DISTINCT requested_audit.id) <> 1
             OR COUNT(DISTINCT completed_audit.id) <> 1
             OR COUNT(DISTINCT requested_event.id) <> 1
             OR COUNT(DISTINCT completed_event.id) <> 1
        ) invalid
      `,
    );

    await requireZero(
      pool,
      "Return refund Foundation idempotency completion",
      `
        SELECT COUNT(*)::int AS count
        FROM refunds refund
        LEFT JOIN idempotency_keys idem
          ON idem.scope = 'returns.refund'
         AND idem.key = refund.idempotency_key
        WHERE refund.status = 'completed'
          AND (
            idem.id IS NULL
            OR idem.status <> 'completed'
            OR idem.response_status <> 200
            OR idem.response_body->>'refundId' IS DISTINCT FROM refund.id::text
            OR idem.response_body->>'returnRequestId' IS DISTINCT FROM refund.return_request_id::text
          )
      `,
    );

    await requireZero(
      pool,
      "Return seller-scoped audit ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM audit_logs audit
        JOIN return_requests request ON request.id::text = audit.resource_id
        JOIN seller_orders seller_order ON seller_order.id = request.seller_order_id
        WHERE audit.resource_type = 'return_request'
          AND audit.action IN ('return.requested', 'return.approved', 'return.rejected', 'return.received', 'return.closed')
          AND audit.seller_id IS DISTINCT FROM seller_order.seller_id
      `,
    );

    console.log("Module 14 post-E2E Returns, Refunds & Disputes reconciliation passed.");
  } finally {
    await pool.end();
  }
}

await main();
