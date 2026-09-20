import type { Job } from "bullmq";
import { AppError } from "../../common/errors/app-error.js";
import { createWorker } from "../../common/jobs/queue.factory.js";
import { logger } from "../../common/logger/logger.js";
import type { DomainEventJobData } from "../../common/outbox/bullmq-event.publisher.js";
import { NotificationEmailProviderError } from "../../integrations/email/notification-email-provider.contract.js";
import {
  NOTIFICATIONS_ERROR_CODE,
  NOTIFICATIONS_JOB,
  NOTIFICATIONS_OUTBOX_EVENT,
} from "./notifications.constants.js";

/** Minimum Module 18 service boundary required by the background runtime. */
export interface NotificationsJobProcessor {
  /** Ensures built-in direct-recipient templates exist before source events can be consumed. */
  ensureDefaultTemplates(): Promise<void>;

  /** Converts one committed non-Notification source event into durable Notification deliveries. */
  dispatchCommittedEvent(sourceEventId: string): Promise<unknown>;

  /** Executes one already-durable queued delivery idempotently. */
  processQueuedDelivery(deliveryId: string): Promise<void>;

  /** Persists one retryable/final worker failure without exposing raw provider output. */
  recordDeliveryFailure(deliveryId: string, errorCode: string, finalAttempt: boolean): Promise<void>;
}

/** Background resources owned only by Module 18 Notification dispatch/delivery. */
export interface NotificationsRuntime {
  /** Stops new Notification background work and closes its BullMQ worker connection. */
  close(): Promise<void>;
}

/** Returns true when a BullMQ attempt is the last configured attempt for this delivery job. */
function isFinalAttempt(job: Job<DomainEventJobData>): boolean {
  const configuredAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= configuredAttempts;
}

/** Converts one internal/provider failure into a stable persisted error code. */
function deliveryErrorCode(error: unknown): string {
  if (error instanceof NotificationEmailProviderError) return error.code;
  if (error instanceof AppError) return error.code;
  return NOTIFICATIONS_ERROR_CODE.DELIVERY_FAILED;
}

/** Returns one delivery id only for the Module 18 queued-delivery lifecycle event. */
function queuedDeliveryId(job: DomainEventJobData): string | null {
  const event = job.event;
  if (event.eventType !== NOTIFICATIONS_OUTBOX_EVENT.QUEUED) return null;
  return typeof event.aggregateId === "string" && event.aggregateId.length > 0
    ? event.aggregateId
    : null;
}

/** Returns true for Module 18 lifecycle events that must not be remapped into another Notification. */
function isNotificationLifecycleEvent(eventType: string): boolean {
  return Object.values(NOTIFICATIONS_OUTBOX_EVENT).some((value) => value === eventType);
}

/** Runs one committed outbox event through source dispatch or delivery execution without recursive Notification events. */
async function processSourceEvent(
  processor: NotificationsJobProcessor,
  job: Job<DomainEventJobData>,
): Promise<void> {
  const deliveryId = queuedDeliveryId(job.data);
  if (deliveryId) {
    try {
      await processor.processQueuedDelivery(deliveryId);
    } catch (error) {
      await processor.recordDeliveryFailure(
        deliveryId,
        deliveryErrorCode(error),
        isFinalAttempt(job),
      );
      throw error;
    }
    return;
  }

  if (isNotificationLifecycleEvent(job.data.event.eventType)) return;
  await processor.dispatchCommittedEvent(job.data.eventId);
}

/** Starts the independent Foundation-outbox consumer used for both source dispatch and durable delivery execution. */
export async function startNotificationsRuntime(
  processor: NotificationsJobProcessor,
): Promise<NotificationsRuntime> {
  await processor.ensureDefaultTemplates();
  const worker = createWorker<DomainEventJobData>(
    NOTIFICATIONS_JOB.SOURCE_EVENT_QUEUE,
    async (job) => processSourceEvent(processor, job),
  );
  let closed = false;

  /** Logs a terminal/retrying BullMQ failure without logging provider request bodies or raw destinations. */
  function logFailure(job: Job<DomainEventJobData> | undefined, error: Error): void {
    logger.error(
      {
        err: error,
        jobId: job?.id,
        eventType: job?.data.event.eventType,
        deliveryId: job ? queuedDeliveryId(job.data) : null,
      },
      "Notification background job failed",
    );
  }

  worker.on("failed", logFailure);

  return {
    /** Closes the Module 18 worker once while preserving BullMQ's durable queued jobs for restart. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await worker.close();
    },
  };
}
