import { checkDatabaseConnection, closeDatabase } from "./db.js";

/** Verifies that the configured PostgreSQL connection is reachable. */
async function main(): Promise<void> {
  try {
    await checkDatabaseConnection();
    console.log("PostgreSQL connection check passed.");
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error("PostgreSQL connection check failed.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exitCode = 1;
});
