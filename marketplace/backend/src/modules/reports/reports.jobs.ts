import type { Job } from "bullmq";
import { AppError } from "../../common/errors/app-error.js";
import { createWorker } from "../../common/jobs/queue.factory.js";
import { logger } from "../../common/logger/logger.js";
import type { DomainEventJobData } from "../../common/outbox/bullmq-event.publisher.js";
import { REPORTS_ERROR_CODE, REPORTS_JOB, REPORTS_OUTBOX_EVENT } from "./reports.constants.js";

/** Minimum Reports service boundary needed by the background export worker. */
export interface ReportsJobProcessor {
  /** Executes one queued export run from already-persisted server-derived scope. */
  processReportRun(reportRunId: string): Promise<void>;

  /** Persists the final safe error state after BullMQ exhausts retries. */
  recordReportRunFailure(reportRunId: string, errorCode: string, finalAttempt: boolean): Promise<void>;
}

/** Background resources owned by the Module 20 asynchronous report runtime. */
export interface ReportsRuntime {
  /** Stops new report work and closes the BullMQ worker connection. */
  close(): Promise<void>;
}

/** Returns true when the current BullMQ attempt is the final configured attempt. */
function isFinalAttempt(job: Job<DomainEventJobData>): boolean {
  const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

/** Converts unknown worker failures into stable persisted Module 20 error codes. */
function reportFailureCode(error: unknown): string {
  return error instanceof AppError ? error.code : REPORTS_ERROR_CODE.EXPORT_FAILED;
}

/** Extracts one report-run id only from the report.run_requested event. */
function requestedRunId(job: DomainEventJobData): string | null {
  if (job.event.eventType !== REPORTS_OUTBOX_EVENT.RUN_REQUESTED) return null;
  return typeof job.event.aggregateId === "string" && job.event.aggregateId.length > 0
    ? job.event.aggregateId
    : null;
}

/** Executes one Module 20 request event and leaves generated/failed lifecycle events for Notifications only. */
async function processSourceEvent(
  processor: ReportsJobProcessor,
  job: Job<DomainEventJobData>,
): Promise<void> {
  const reportRunId = requestedRunId(job.data);
  if (!reportRunId) return;

  try {
    await processor.processReportRun(reportRunId);
  } catch (error) {
    await processor.recordReportRunFailure(
      reportRunId,
      reportFailureCode(error),
      isFinalAttempt(job),
    );
    throw error;
  }
}

/** Starts the independent Foundation-outbox consumer for asynchronous report export generation. */
export async function startReportsRuntime(
  processor: ReportsJobProcessor,
): Promise<ReportsRuntime> {
  const worker = createWorker<DomainEventJobData>(
    REPORTS_JOB.SOURCE_EVENT_QUEUE,
    async (job) => processSourceEvent(processor, job),
  );
  let closed = false;

  /** Logs safe worker metadata without filters, report rows, or generated document contents. */
  function logFailure(job: Job<DomainEventJobData> | undefined, error: Error): void {
    logger.error(
      {
        err: error,
        jobId: job?.id,
        eventType: job?.data.event.eventType,
        reportRunId: job ? requestedRunId(job.data) : null,
      },
      "Reports background job failed",
    );
  }

  worker.on("failed", logFailure);

  return {
    /** Closes the Module 20 worker once while preserving durable queued jobs for restart. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await worker.close();
    },
  };
}
