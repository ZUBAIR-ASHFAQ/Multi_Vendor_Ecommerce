import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const failedDeliveryId = "18181818-0000-4000-8000-000000000003";

/** Reads one scalar count from a read-only Module 18 release-integrity query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Fails the release gate when a Notification invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row group(s).`);
}

/** Requires the Module 18 Playwright workflow to have produced durable database evidence. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Waits briefly for one asynchronous BullMQ delivery to converge before final reconciliation assertions. */
async function waitForAtLeastOne(pool, label, sql, values = [], timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countRows(pool, sql, values)) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not converge before the release-data timeout.`);
}

/** Verifies cross-module dispatch, read state, preferences, retry audit, masking, idempotency, and delivery completion. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireAtLeastOne(
      pool,
      "Module 18 seller-approved in-app notification",
      `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE type = 'seller.approved'
          AND title = 'Seller application approved'
          AND read_at IS NOT NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 18 seller-rejected in-app notification",
      `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE type = 'seller.rejected'
          AND title = 'Seller application update'
          AND read_at IS NOT NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 18 persisted user preference",
      `
        SELECT COUNT(*)::int AS count
        FROM notification_preferences
        WHERE event_code = 'seller.approved'
          AND channel = 'email'
          AND enabled = false
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 18 notification.read lifecycle evidence",
      "SELECT COUNT(*)::int AS count FROM outbox_events WHERE event_type = 'notification.read'",
    );

    await requireAtLeastOne(
      pool,
      "Module 18 privileged retry audit evidence",
      `
        SELECT COUNT(*)::int AS count
        FROM audit_logs
        WHERE action = 'notifications.delivery_retry_requested'
          AND entity_type = 'notification_delivery'
          AND entity_id = $1
      `,
      [failedDeliveryId],
    );

    await waitForAtLeastOne(
      pool,
      "Module 18 deterministic provider reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM notification_deliveries
        WHERE id = $1
          AND status = 'sent'
          AND provider_ref = $2
          AND last_error_code IS NULL
      `,
      [failedDeliveryId, `test-email:${failedDeliveryId}`],
    );

    await requireAtLeastOne(
      pool,
      "Module 18 retried delivery sent lifecycle event",
      `
        SELECT COUNT(*)::int AS count
        FROM outbox_events
        WHERE event_type = 'notification.sent'
          AND aggregate_type = 'notification_delivery'
          AND aggregate_id = $1
      `,
      [failedDeliveryId],
    );

    await requireZero(
      pool,
      "Module 18 event/recipient/channel idempotency",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT source_event_id, user_id, channel
          FROM notification_deliveries
          GROUP BY source_event_id, user_id, channel
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Module 18 raw email destination persistence",
      `
        SELECT COUNT(*)::int AS count
        FROM notification_deliveries delivery
        JOIN users app_user ON app_user.id = delivery.user_id
        WHERE delivery.channel = 'email'
          AND lower(delivery.destination_masked) = lower(app_user.email)
      `,
    );

    await requireZero(
      pool,
      "Module 18 malformed email masking",
      `
        SELECT COUNT(*)::int AS count
        FROM notification_deliveries
        WHERE channel = 'email'
          AND destination_masked NOT LIKE '%***@%'
      `,
    );

    await requireZero(
      pool,
      "Module 18 in-app delivery attachment",
      `
        SELECT COUNT(*)::int AS count
        FROM notification_deliveries
        WHERE channel = 'in_app'
          AND notification_id IS NULL
      `,
    );

    await requireZero(
      pool,
      "Module 18 stuck processing delivery",
      "SELECT COUNT(*)::int AS count FROM notification_deliveries WHERE status = 'processing'",
    );

    console.log("Module 18 post-E2E Notifications reconciliation verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
