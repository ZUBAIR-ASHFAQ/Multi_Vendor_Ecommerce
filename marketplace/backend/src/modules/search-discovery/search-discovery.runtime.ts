import { logger } from "../../common/logger/logger.js";
import { createWorker } from "../../common/jobs/queue.factory.js";
import type { DomainEventJobData } from "../../common/outbox/bullmq-event.publisher.js";
import { SEARCH_JOB } from "./search-discovery.constants.js";
import { createSearchReindexWorker } from "./search-discovery.jobs.js";
import type { SearchDiscoveryService } from "./search-discovery.service.js";

/** Background resources owned only by Module 19 Search. */
export interface SearchDiscoveryRuntime {
  /** Stops Search workers without touching Foundation outbox producers. */
  close(): Promise<void>;
}

/** Starts Search's independent source-event consumer and full-reindex worker. */
export async function startSearchDiscoveryRuntime(
  service: SearchDiscoveryService,
): Promise<SearchDiscoveryRuntime> {
  const sourceEventWorker = createWorker<DomainEventJobData>(
    SEARCH_JOB.SOURCE_EVENT_QUEUE,
    async (job) => {
      await service.handleSourceEvent(job.data.event);
    },
  );
  const reindexWorker = createSearchReindexWorker(service);
  let closed = false;

  /** Logs a failed Search source-event delivery after BullMQ applies its configured retry policy. */
  function logSourceEventFailure(
    job: { id?: string; data: DomainEventJobData } | undefined,
    error: Error,
  ): void {
    logger.error(
      { err: error, jobId: job?.id, eventType: job?.data.event.eventType },
      "Search source-event job failed",
    );
  }

  /** Logs a failed full-reindex job; persisted run state is handled by the reindex processor. */
  function logReindexFailure(
    job: { id?: string; data: { reindexRunId: string } } | undefined,
    error: Error,
  ): void {
    logger.error(
      { err: error, jobId: job?.id, reindexRunId: job?.data.reindexRunId },
      "Search reindex job failed",
    );
  }

  sourceEventWorker.on("failed", logSourceEventFailure);
  reindexWorker.on("failed", logReindexFailure);

  try {
    await service.recoverQueuedReindexJob();
  } catch (error) {
    logger.warn(
      { err: error },
      "Queued Search reindex recovery will be retried by a later admin/source event",
    );
  }

  return {
    /** Stops accepting Search background work and closes both Search worker connections. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([sourceEventWorker.close(), reindexWorker.close()]);
    },
  };
}
