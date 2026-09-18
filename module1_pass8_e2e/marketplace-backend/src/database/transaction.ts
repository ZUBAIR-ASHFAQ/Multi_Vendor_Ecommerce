import { db } from "./db.js";
import type { DatabaseTransaction } from "./types.js";

/**
 * Runs a unit of work in one PostgreSQL transaction.
 * Business services own transaction boundaries; repositories only receive the transaction client.
 */
export async function withTransaction<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(work);
}
