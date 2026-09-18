import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

const approvedReportCodes = [
  "sales",
  "sellers",
  "inventory",
  "refunds",
  "commissions",
  "payouts",
  "audit_log",
];

/** Reads one scalar count from a read-only Module 20 reconciliation query. */
async function countRows(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

/** Requires one reconciliation query to return exactly the expected count. */
async function requireExact(pool, label, expected, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== expected) {
    throw new Error(`${label} expected ${expected} row(s) but found ${count}.`);
  }
}

/** Requires the Module 20 browser workflow to have produced at least one durable row. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Fails the release gate when one Module 20 invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row(s).`);
}

/** Waits briefly for asynchronous Notifications dispatch to converge after report generation. */
async function waitForAtLeastOne(pool, label, sql, values = [], timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countRows(pool, sql, values)) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not converge before the release-data timeout.`);
}

/** Verifies report catalog, export storage, audit/outbox, notification, and terminal-run reconciliation. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireExact(
      pool,
      "Module 20 approved active report catalog",
      approvedReportCodes.length,
      `
        SELECT COUNT(*)::int AS count
        FROM report_definitions
        WHERE status = 'active'
          AND code = ANY($1::text[])
      `,
      [approvedReportCodes],
    );

    await requireZero(
      pool,
      "Module 20 unexpected active report definitions",
      `
        SELECT COUNT(*)::int AS count
        FROM report_definitions
        WHERE status = 'active'
          AND NOT (code = ANY($1::text[]))
      `,
      [approvedReportCodes],
    );

    await requireAtLeastOne(
      pool,
      "Module 20 completed CSV Sales export",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs
        WHERE report_code = 'sales'
          AND output_format = 'csv'
          AND status = 'completed'
          AND file_id IS NOT NULL
          AND started_at IS NOT NULL
          AND finished_at IS NOT NULL
          AND error_code IS NULL
      `,
    );

    await requireAtLeastOne(
      pool,
      "Module 20 completed PDF Sales export",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs
        WHERE report_code = 'sales'
          AND output_format = 'pdf'
          AND status = 'completed'
          AND file_id IS NOT NULL
          AND error_code IS NULL
      `,
    );

    await requireZero(
      pool,
      "Module 20 unfinished E2E report runs",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs
        WHERE status IN ('queued', 'processing')
      `,
    );

    await requireZero(
      pool,
      "Module 20 failed E2E report runs",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs
        WHERE status = 'failed'
      `,
    );

    await requireZero(
      pool,
      "Module 20 generated-file ownership and purpose reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs run
        LEFT JOIN files file ON file.id = run.file_id
        WHERE run.status = 'completed'
          AND (
            run.file_id IS NULL
            OR file.id IS NULL
            OR file.owner_user_id <> run.requested_by
            OR file.purpose <> 'report_export'
            OR file.status <> 'confirmed'
            OR file.size_bytes <= 0
          )
      `,
    );

    await requireZero(
      pool,
      "Module 20 request/generated outbox lifecycle reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs run
        WHERE run.status = 'completed'
          AND (
            NOT EXISTS (
              SELECT 1
              FROM outbox_events event
              WHERE event.event_type = 'report.run_requested'
                AND event.aggregate_type = 'report_run'
                AND event.aggregate_id = run.id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM outbox_events event
              WHERE event.event_type = 'report.generated'
                AND event.aggregate_type = 'report_run'
                AND event.aggregate_id = run.id
            )
          )
      `,
    );

    await requireZero(
      pool,
      "Module 20 request/generated audit lifecycle reconciliation",
      `
        SELECT COUNT(*)::int AS count
        FROM report_runs run
        WHERE run.status = 'completed'
          AND (
            NOT EXISTS (
              SELECT 1
              FROM audit_logs audit
              WHERE audit.action = 'report.run_requested'
                AND audit.entity_type = 'report_run'
                AND audit.entity_id = run.id::text
            )
            OR NOT EXISTS (
              SELECT 1
              FROM audit_logs audit
              WHERE audit.action = 'report.generated'
                AND audit.entity_type = 'report_run'
                AND audit.entity_id = run.id::text
            )
          )
      `,
    );

    await waitForAtLeastOne(
      pool,
      "Module 20 report-ready in-app notification",
      `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE type = 'report.generated'
          AND title = 'Report export ready'
      `,
    );

    await requireZero(
      pool,
      "Module 20 duplicate generated file ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT file_id
          FROM report_runs
          WHERE file_id IS NOT NULL
          GROUP BY file_id
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    console.log("Module 20 post-E2E Reports reconciliation verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
