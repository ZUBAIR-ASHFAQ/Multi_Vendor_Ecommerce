import { logger } from "../logger/logger.js";
import { createQueue, createWorker } from "./queue.factory.js";

const LIFECYCLE_MAINTENANCE_QUEUE = "lifecycle-maintenance";
const LIFECYCLE_MAINTENANCE_INTERVAL_MS = 60_000;
const LIFECYCLE_MAINTENANCE_BATCH_SIZE = 100;

/** Stable maintenance job names so repeated scheduling stays idempotent across application restarts. */
export const LIFECYCLE_MAINTENANCE_JOB = {
  IDEMPOTENCY_CLEANUP: "idempotency-cleanup",
  INVENTORY_RESERVATION_EXPIRY: "inventory-reservation-expiry",
} as const;

type LifecycleMaintenanceJobName =
  (typeof LIFECYCLE_MAINTENANCE_JOB)[keyof typeof LIFECYCLE_MAINTENANCE_JOB];

/** Small service boundary used by the maintenance worker without importing business modules into Foundation. */
export interface LifecycleMaintenanceProcessor {
  /** Deletes one bounded batch of expired terminal idempotency records. */
  cleanupExpiredIdempotencyKeys(limit: number): Promise<number>;

  /** Releases one bounded batch of expired, still-uncommitted Inventory reservations. */
  releaseExpiredInventoryReservations(limit: number): Promise<number>;
}

/** Background resources owned by the shared lifecycle-maintenance queue. */
export interface LifecycleMaintenanceRuntime {
  /** Stops the maintenance worker and closes its producer connection. */
  close(): Promise<void>;
}

/** Dispatches one named maintenance job to the correct service operation. */
export async function runLifecycleMaintenanceJob(
  jobName: LifecycleMaintenanceJobName,
  processor: LifecycleMaintenanceProcessor,
): Promise<number> {
  if (jobName === LIFECYCLE_MAINTENANCE_JOB.IDEMPOTENCY_CLEANUP) {
    return processor.cleanupExpiredIdempotencyKeys(LIFECYCLE_MAINTENANCE_BATCH_SIZE);
  }

  return processor.releaseExpiredInventoryReservations(LIFECYCLE_MAINTENANCE_BATCH_SIZE);
}

/** Starts the retryable BullMQ jobs that clean expired retry keys and temporary stock holds. */
export async function startLifecycleMaintenanceRuntime(
  processor: LifecycleMaintenanceProcessor,
): Promise<LifecycleMaintenanceRuntime> {
  const queue = createQueue<Record<string, never>, number, LifecycleMaintenanceJobName>(
    LIFECYCLE_MAINTENANCE_QUEUE,
  );
  const worker = createWorker<Record<string, never>, number, LifecycleMaintenanceJobName>(
    LIFECYCLE_MAINTENANCE_QUEUE,
    // Processes one scheduled maintenance job and reports useful work without noisy empty-run logs.
    async (job) => {
      const processed = await runLifecycleMaintenanceJob(job.name, processor);
      if (processed > 0) {
        logger.info({ jobName: job.name, processed }, "Lifecycle maintenance processed records");
      }
      return processed;
    },
    { concurrency: 1 },
  );
  let closed = false;

  /** Logs one failed maintenance attempt after BullMQ applies the configured retry policy. */
  function logMaintenanceFailure(
    job: { id?: string; name: string } | undefined,
    error: Error,
  ): void {
    logger.error(
      { err: error, jobId: job?.id, jobName: job?.name },
      "Lifecycle maintenance job failed",
    );
  }

  worker.on("failed", logMaintenanceFailure);

  try {
    await Promise.all([
      queue.upsertJobScheduler(
        LIFECYCLE_MAINTENANCE_JOB.IDEMPOTENCY_CLEANUP,
        { every: LIFECYCLE_MAINTENANCE_INTERVAL_MS },
        {
          name: LIFECYCLE_MAINTENANCE_JOB.IDEMPOTENCY_CLEANUP,
          data: {},
        },
      ),
      queue.upsertJobScheduler(
        LIFECYCLE_MAINTENANCE_JOB.INVENTORY_RESERVATION_EXPIRY,
        { every: LIFECYCLE_MAINTENANCE_INTERVAL_MS },
        {
          name: LIFECYCLE_MAINTENANCE_JOB.INVENTORY_RESERVATION_EXPIRY,
          data: {},
        },
      ),
    ]);
  } catch (error) {
    await Promise.allSettled([worker.close(), queue.close()]);
    throw error;
  }

  return {
    /** Stops future work in this process while leaving BullMQ job schedulers available after restart. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([worker.close(), queue.close()]);
    },
  };
}
