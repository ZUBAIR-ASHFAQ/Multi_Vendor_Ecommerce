import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationsDirectory = path.resolve("drizzle");
const module15Migration = "0031_reviews_ratings.sql";

/** Returns released migrations through the Module 15 database migration in deterministic order. */
async function migrationSequence() {
  return (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name <= module15Migration)
    .sort();
}

/** Resets the disposable PostgreSQL public schema before one migration scenario. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed SQL migration using the repository statement separator. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

/** Throws one focused migration verification error when a condition is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one public table exists in the disposable database. */
async function tableExists(tableName) {
  const result = await pool.query("select to_regclass($1) as table_name", [
    `public.${tableName}`,
  ]);
  return result.rows[0]?.table_name === tableName;
}

/** Returns whether one named public index exists. */
async function indexExists(indexName) {
  const result = await pool.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = $1`,
    [indexName],
  );
  return result.rowCount === 1;
}

/** Returns whether one named table constraint exists. */
async function constraintExists(tableName, constraintName) {
  const result = await pool.query(
    `select 1
       from information_schema.table_constraints
      where table_schema = 'public' and table_name = $1 and constraint_name = $2`,
    [tableName, constraintName],
  );
  return result.rowCount === 1;
}

/** Returns database metadata for one public column. */
async function columnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

/** Verifies the four Module 15 tables and their concurrency/privacy-critical persistence invariants. */
async function verifyModule15Shape() {
  for (const tableName of [
    "reviews",
    "review_helpful_votes",
    "review_moderation_history",
    "rating_aggregates",
  ]) {
    assertCondition(await tableExists(tableName), `Missing Module 15 table: ${tableName}`);
  }

  assertCondition(
    await indexExists("reviews_order_item_uq"),
    "One purchased Order Item must not create more than one Review.",
  );
  assertCondition(
    await constraintExists("reviews", "reviews_store_seller_fk"),
    "Review Store identity must belong to the stored Seller.",
  );
  assertCondition(
    await constraintExists("reviews", "reviews_rating_check"),
    "Review rating must be constrained to 1..5.",
  );
  assertCondition(
    await constraintExists("reviews", "reviews_status_check"),
    "Review status must be constrained to pending/published/hidden.",
  );
  assertCondition(
    await constraintExists("reviews", "reviews_verified_purchase_check"),
    "Persisted Reviews must be server-verified purchases.",
  );
  assertCondition(
    await constraintExists("review_helpful_votes", "review_helpful_votes_pk"),
    "Helpful voting must be unique per Review/user pair.",
  );
  assertCondition(
    await constraintExists(
      "review_moderation_history",
      "review_moderation_history_action_check",
    ),
    "Moderation history must accept only the approved hide/publish actions.",
  );
  assertCondition(
    await constraintExists("rating_aggregates", "rating_aggregates_pk"),
    "Rating aggregate identity must be entity_type + entity_id.",
  );

  const storeId = await columnDefinition("reviews", "store_id");
  assertCondition(
    storeId?.data_type === "uuid" && storeId?.is_nullable === "NO",
    "Review store_id must be a required immutable UUID identity.",
  );

  const ratingAverage = await columnDefinition("rating_aggregates", "rating_avg");
  assertCondition(
    ratingAverage?.data_type === "numeric" &&
      ratingAverage?.numeric_precision === 4 &&
      ratingAverage?.numeric_scale === 2,
    "Rating aggregate average must use NUMERIC(4,2) to match the Search read model.",
  );
}

/** Proves both the supported 0030 -> 0031 upgrade and a clean migration history through Module 15. */
async function main() {
  try {
    const migrations = await migrationSequence();
    assertCondition(
      migrations.at(-1) === module15Migration,
      `Expected ${module15Migration} to be the Module 15 migration ceiling.`,
    );

    const preModule15 = migrations.filter((name) => name !== module15Migration);

    await resetSchema();
    for (const migration of preModule15) await applyMigration(migration);
    assertCondition(
      !(await tableExists("reviews")),
      "Reviews tables must not exist before migration 0031.",
    );
    await applyMigration(module15Migration);
    await verifyModule15Shape();

    await resetSchema();
    for (const migration of migrations) await applyMigration(migration);
    await verifyModule15Shape();

    console.log("Module 15 migration verification passed.");
  } finally {
    await pool.end();
  }
}

await main();
