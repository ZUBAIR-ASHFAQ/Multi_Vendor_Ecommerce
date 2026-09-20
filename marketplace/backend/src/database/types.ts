import type { db } from "./db.js";

/**
 * Minimal Drizzle command surface accepted by repositories.
 * Both the root database client and a Drizzle transaction satisfy this contract.
 */
export type DatabaseExecutor = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute"
>;

/** Transaction client type inferred from the configured Drizzle database instance. */
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
