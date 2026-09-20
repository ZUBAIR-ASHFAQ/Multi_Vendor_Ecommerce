import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  console.log("Test database schema reset.");
} finally {
  await pool.end();
}
