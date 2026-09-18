import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";
import type { DomainEvent } from "./outbox.contract.js";
import { OutboxRepository } from "./outbox.repository.js";

export interface DomainEventPublisher {
  publish(eventId: string, event: DomainEvent): Promise<void>;
}

/** Claims and publishes eligible outbox rows with bounded exponential retry scheduling. */
export class OutboxDispatcherService {
  /** Stores the outbox repository and provider-neutral event publisher. */
  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: DomainEventPublisher,
  ) {}

  /** Claims and publishes one retry-safe batch of pending outbox events. */
  async dispatchBatch(now = new Date()): Promise<{ published: number; failed: number }> {
    const rows = await this.repository.findDispatchable(now, env.OUTBOX_BATCH_SIZE);
    let published = 0;
    let failed = 0;

    for (const row of rows) {
      const leaseUntil = new Date(now.getTime() + env.OUTBOX_CLAIM_SECONDS * 1_000);
      const claimed = await this.repository.markProcessing(row.id, now, leaseUntil);
      if (!claimed) continue;

      try {
        await this.publisher.publish(claimed.id, {
          eventType: claimed.eventType,
          ...(claimed.aggregateType ? { aggregateType: claimed.aggregateType } : {}),
          ...(claimed.aggregateId ? { aggregateId: claimed.aggregateId } : {}),
          payload: claimed.payload,
          ...(claimed.headers && typeof claimed.headers === "object"
            ? { headers: claimed.headers as Record<string, unknown> }
            : {}),
        });
        await this.repository.markPublished(claimed.id);
        published += 1;
      } catch (error) {
        const retryDelay = Math.min(
          env.OUTBOX_MAX_RETRY_DELAY_MS,
          env.OUTBOX_BASE_RETRY_DELAY_MS * 2 ** Math.max(0, claimed.attempts - 1),
        );
        const message = error instanceof Error ? error.message : "Unknown outbox publish error";
        await this.repository.markFailed(
          claimed.id,
          message.slice(0, 4_000),
          new Date(Date.now() + retryDelay),
        );
        logger.error({ err: error, outboxEventId: claimed.id }, "Outbox event publish failed");
        failed += 1;
      }
    }

    return { published, failed };
  }
}
