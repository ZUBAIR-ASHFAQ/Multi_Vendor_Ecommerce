import pg from "pg";

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const sellerAEmail = process.env.E2E_SELLER_A_EMAIL ?? "e2e.seller.a@marketplace.test";
const savedFilterName = "Module 1 E2E saved filter";
const forbiddenSavedFilterName = "Forbidden Seller B scope";

/** Reads one scalar count from a read-only Module 1 reconciliation query. */
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

/** Requires one Dashboard browser workflow to have produced at least one durable row. */
async function requireAtLeastOne(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count < 1) throw new Error(`${label} did not produce any persisted rows.`);
}

/** Fails the release gate when one Module 1 invariant query finds invalid rows. */
async function requireZero(pool, label, sql, values = []) {
  const count = await countRows(pool, sql, values);
  if (count !== 0) throw new Error(`${label} failed with ${count} invalid row(s).`);
}

/** Verifies Dashboard preference ownership, saved filters, audit, and outbox reconciliation after Playwright. */
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    await requireExact(
      pool,
      "Module 1 E2E administrator preference snapshot",
      1,
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_preferences preference
        INNER JOIN users account ON account.id = preference.user_id
        WHERE lower(account.email) = lower($1)
          AND preference.default_date_range = 'last_7_days'
      `,
      [adminEmail],
    );

    await requireExact(
      pool,
      "Module 1 E2E administrator saved filter",
      1,
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_saved_filters filter
        INNER JOIN users account ON account.id = filter.user_id
        WHERE lower(account.email) = lower($1)
          AND filter.name = $2
          AND jsonb_typeof(filter.filter_json) = 'object'
      `,
      [adminEmail, savedFilterName],
    );

    await requireAtLeastOne(
      pool,
      "Module 1 Dashboard preference audit lifecycle",
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_preferences preference
        INNER JOIN users account ON account.id = preference.user_id
        INNER JOIN audit_logs audit
          ON audit.action = 'dashboard.preferences_updated'
         AND audit.resource_type = 'dashboard_preferences'
         AND audit.resource_id = preference.id::text
         AND audit.actor_user_id = preference.user_id
        WHERE lower(account.email) = lower($1)
      `,
      [adminEmail],
    );

    await requireAtLeastOne(
      pool,
      "Module 1 Dashboard preference outbox lifecycle",
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_preferences preference
        INNER JOIN users account ON account.id = preference.user_id
        INNER JOIN outbox_events event
          ON event.event_type = 'dashboard.preferences_updated'
         AND event.aggregate_type = 'dashboard_preferences'
         AND event.aggregate_id = preference.id::text
        WHERE lower(account.email) = lower($1)
          AND event.payload ->> 'userId' = preference.user_id::text
      `,
      [adminEmail],
    );

    await requireExact(
      pool,
      "Module 1 denied cross-seller saved-filter write",
      0,
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_saved_filters filter
        INNER JOIN users account ON account.id = filter.user_id
        WHERE lower(account.email) = lower($1)
          AND filter.name = $2
      `,
      [sellerAEmail, forbiddenSavedFilterName],
    );

    await requireZero(
      pool,
      "Module 1 duplicate Dashboard preference ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT user_id
          FROM dashboard_preferences
          GROUP BY user_id
          HAVING COUNT(*) > 1
        ) duplicate
      `,
    );

    await requireZero(
      pool,
      "Module 1 orphaned saved-filter ownership",
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_saved_filters filter
        LEFT JOIN users account ON account.id = filter.user_id
        LEFT JOIN dashboard_preferences preference ON preference.user_id = filter.user_id
        WHERE account.id IS NULL OR preference.id IS NULL
      `,
    );

    await requireZero(
      pool,
      "Module 1 malformed persisted Dashboard preference JSON",
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_preferences
        WHERE jsonb_typeof(layout_json) <> 'object'
           OR length(btrim(default_date_range)) = 0
      `,
    );

    await requireZero(
      pool,
      "Module 1 malformed persisted saved-filter JSON",
      `
        SELECT COUNT(*)::int AS count
        FROM dashboard_saved_filters
        WHERE jsonb_typeof(filter_json) <> 'object'
           OR length(btrim(name)) = 0
      `,
    );

    console.log("Module 1 post-E2E Dashboard preference reconciliation verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
