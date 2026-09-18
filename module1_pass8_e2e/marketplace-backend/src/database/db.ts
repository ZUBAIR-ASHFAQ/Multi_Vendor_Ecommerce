import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

const ssl = env.DB_SSL
  ? {
      rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    }
  : undefined;

/** Shared PostgreSQL connection pool for the backend process. */
export const databasePool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  application_name: env.DB_APPLICATION_NAME,
  ...(ssl ? { ssl } : {}),
});

/** Typed Drizzle database instance. */
export const db = drizzle(databasePool, { schema });

/** Verifies that PostgreSQL accepts a query. */
export async function checkDatabaseConnection(): Promise<void> {
  await databasePool.query("select 1 as ok");
}

/** Closes the PostgreSQL pool during shutdown or one-off scripts. */
export async function closeDatabase(): Promise<void> {
  await databasePool.end();
}
