import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import {
  BullMqDomainEventPublisher,
  type DomainEventJobData,
} from "../../src/common/outbox/bullmq-event.publisher.js";
import type { DomainEvent } from "../../src/common/outbox/outbox.contract.js";

/** Creates the minimum BullMQ queue test double needed by the Foundation fan-out publisher. */
function queueStub() {
  return {
    add: vi.fn().mockResolvedValue({ id: "job" }),
  } as unknown as Queue<DomainEventJobData>;
}

/** Builds one simple domain event without coupling the test to a business module. */
function domainEvent(): DomainEvent {
  return {
    eventType: "foundation.test_event",
    aggregateType: "test",
    aggregateId: "entity-1",
    payload: { value: 1 },
  };
}

describe("Foundation domain-event fan-out publisher", () => {
  it("publishes the same retry-safe event to every independent consumer queue", async () => {
    const searchQueue = queueStub();
    const notificationQueue = queueStub();
    const publisher = new BullMqDomainEventPublisher([searchQueue, notificationQueue]);
    const event = domainEvent();

    await publisher.publish("event-1", event);

    for (const queue of [searchQueue, notificationQueue]) {
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        event.eventType,
        { eventId: "event-1", event },
        expect.objectContaining({ jobId: "event-1" }),
      );
    }
  });

  it("fails the publish operation when any destination queue cannot accept the event", async () => {
    const healthyQueue = queueStub();
    const failingQueue = queueStub();
    (failingQueue.add as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("queue unavailable"),
    );
    const publisher = new BullMqDomainEventPublisher([healthyQueue, failingQueue]);

    await expect(publisher.publish("event-2", domainEvent())).rejects.toThrow(
      "queue unavailable",
    );
  });

  it("rejects an invalid dispatcher composition with no destination queues", () => {
    expect(() => new BullMqDomainEventPublisher([])).toThrow(
      "At least one domain-event destination queue is required.",
    );
  });
});
