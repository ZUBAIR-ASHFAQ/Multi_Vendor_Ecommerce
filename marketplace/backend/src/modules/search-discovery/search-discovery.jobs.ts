import type { Job } from "bullmq";
import { createQueue, createWorker } from "../../common/jobs/queue.factory.js";
import {
  SEARCH_JOB,
  SEARCH_REINDEX_FAILURE_CODE,
} from "./search-discovery.constants.js";

/** Stable BullMQ payload for one full-catalog Search reindex. */
export interface SearchReindexJobData {
  reindexRunId: string;
}

/** Minimum worker behavior needed by the queue adapter without importing service implementation details. */
export interface SearchReindexJobProcessor {
  /** Runs or resumes one retry-safe persisted reindex. */
  runFullReindex(reindexRunId: string): Promise<unknown>;

  /** Records a stable terminal failure after BullMQ exhausts its configured attempts. */
  failReindexRun(
    reindexRunId: string,
    errorCode: typeof SEARCH_REINDEX_FAILURE_CODE.PROCESSING_FAILED,
  ): Promise<void>;
}

/** Adds one retry-safe reindex job and closes the short-lived producer connection after enqueueing. */
export async function enqueueSearchReindexJob(reindexRunId: string): Promise<void> {
  const queue = createQueue<SearchReindexJobData>(SEARCH_JOB.REINDEX_QUEUE);
  try {
    await queue.add(
      SEARCH_JOB.FULL_REINDEX,
      { reindexRunId },
      { jobId: reindexRunId },
    );
  } finally {
    await queue.close();
  }
}

/** Returns true when the currently failing BullMQ execution is the job's final configured attempt. */
function isFinalAttempt(job: Job<SearchReindexJobData>): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}

/** Creates the Module 19 worker; retries resume the idempotent reindex and only the final failure closes its run. */
export function createSearchReindexWorker(processor: SearchReindexJobProcessor) {
  return createWorker<SearchReindexJobData>(
    SEARCH_JOB.REINDEX_QUEUE,
    async (job) => {
      try {
        await processor.runFullReindex(job.data.reindexRunId);
      } catch (error) {
        if (isFinalAttempt(job)) {
          await processor.failReindexRun(
            job.data.reindexRunId,
            SEARCH_REINDEX_FAILURE_CODE.PROCESSING_FAILED,
          );
        }
        throw error;
      }
    },
  );
}
