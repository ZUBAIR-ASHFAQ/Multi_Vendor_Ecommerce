import { type Queue } from "bullmq";
import type { DomainEventPublisher } from "./outbox-dispatcher.service.js";
import type { DomainEvent } from "./outbox.contract.js";

export interface DomainEventJobData {
  eventId: string;
  event: DomainEvent;
}

/**
 * Publishes one committed outbox event to every independent consumer queue.
 * Each queue receives the same event ID so a dispatcher retry cannot create a second logical job.
 */
export class BullMqDomainEventPublisher implements DomainEventPublisher {
  /** Stores the independent consumer queues that must each receive every committed domain event. */
  constructor(private readonly queues: Array<Queue<DomainEventJobData>>) {
    if (queues.length === 0) {
      throw new Error("At least one domain-event destination queue is required.");
    }
  }

  /** Publishes one event to every consumer queue before the outbox row can be marked published. */
  async publish(eventId: string, event: DomainEvent): Promise<void> {
    await Promise.all(
      this.queues.map(async (queue) => {
        await queue.add(event.eventType, { eventId, event }, {
          jobId: eventId,
          // Keep completed domain-event IDs for a bounded period so a rare dispatcher retry
          // cannot duplicate a delivery after another destination already accepted the event.
          removeOnComplete: { age: 86_400, count: 100_000 },
          removeOnFail: { age: 604_800, count: 100_000 },
        });
      }),
    );
  }
}
