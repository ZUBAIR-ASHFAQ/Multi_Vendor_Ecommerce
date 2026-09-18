import { databasePool } from "../../src/database/db.js";
import { resetModule4Tables } from "../module4/module4.test-helpers.js";
import { resetModule20ReportTables } from "../module20/module20.test-helpers.js";

/** Clears Dashboard-owned rows plus the identity/seller/report state used by Module 1 HTTP tests. */
export async function resetModule1HttpTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      dashboard_saved_filters,
      dashboard_preferences
    RESTART IDENTITY CASCADE
  `);
  await resetModule4Tables();
  await resetModule20ReportTables();
}

/** Counts one Dashboard preference audit action without depending on row ordering. */
export async function countDashboardAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts one Dashboard outbox event without depending on row ordering. */
export async function countDashboardOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads persisted Dashboard preference ownership for one user. */
export async function readDashboardPreference(userId: string): Promise<{
  userId: string;
  defaultStoreId: string | null;
  defaultDateRange: string;
} | null> {
  const result = await databasePool.query<{
    user_id: string;
    default_store_id: string | null;
    default_date_range: string;
  }>(
    `select user_id, default_store_id, default_date_range
       from dashboard_preferences
      where user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row
    ? {
        userId: row.user_id,
        defaultStoreId: row.default_store_id,
        defaultDateRange: row.default_date_range,
      }
    : null;
}

/** Counts persisted saved filters belonging to exactly one Dashboard user. */
export async function countDashboardSavedFilters(userId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from dashboard_saved_filters where user_id = $1",
    [userId],
  );
  return result.rows[0]?.count ?? 0;
}
