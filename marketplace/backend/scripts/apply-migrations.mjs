import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const migrationsDirectory = path.resolve("drizzle");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply migrations.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS foundation_migration_history (
      migration_name text PRIMARY KEY,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(
      `No SQL migration files found in ${migrationsDirectory}`,
    );
  }

  for (const file of files) {
    const fullPath = path.join(migrationsDirectory, file);
    const sqlText = await readFile(fullPath, "utf8");

    const checksum = createHash("sha256")
      .update(sqlText)
      .digest("hex");

    const existing = await pool.query(
      "select checksum_sha256 from foundation_migration_history where migration_name = $1",
      [file],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) {
        throw new Error(
          `Migration ${file} was modified after it was applied.`,
        );
      }

      continue;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sqlText);

      await client.query(
        "insert into foundation_migration_history (migration_name, checksum_sha256) values ($1, $2)",
        [file, checksum],
      );

      await client.query("COMMIT");

      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
