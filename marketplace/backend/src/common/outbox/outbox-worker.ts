import { logger } from "../logger/logger.js";
import { createQueue } from "../jobs/queue.factory.js";
import { OutboxRepository } from "./outbox.repository.js";
import { OutboxDispatcherService } from "./outbox-dispatcher.service.js";
import { BullMqDomainEventPublisher, type DomainEventJobData } from "./bullmq-event.publisher.js";

const OUTBOX_POLL_INTERVAL_MS = 500;

/** Background resources owned by Foundation's transactional-outbox dispatcher. */
export interface OutboxRuntime {
  /** Stops polling and closes every BullMQ producer connection owned by the dispatcher. */
  close(): Promise<void>;
}

/** Creates one independent domain-event destination queue. */
export function createDomainEventQueue(queueName: string) {
  return createQueue<DomainEventJobData>(queueName);
}

/**
 * Creates the Foundation outbox dispatcher with explicit independent destination queues.
 * The application composition root supplies queue names so Foundation does not import business modules.
 */
export function createOutboxDispatcher(destinationQueueNames: readonly string[]): {
  dispatcher: OutboxDispatcherService;
  queues: Array<ReturnType<typeof createDomainEventQueue>>;
} {
  const uniqueQueueNames = [...new Set(destinationQueueNames)];
  if (uniqueQueueNames.length === 0) {
    throw new Error("At least one outbox destination queue is required.");
  }

  const queues = uniqueQueueNames.map((queueName) => createDomainEventQueue(queueName));
  const publisher = new BullMqDomainEventPublisher(queues);

  return {
    dispatcher: new OutboxDispatcherService(new OutboxRepository(), publisher),
    queues,
  };
}

/** Starts Foundation's outbox polling loop independently from any business-module runtime. */
export async function startOutboxRuntime(
  destinationQueueNames: readonly string[],
): Promise<OutboxRuntime> {
  const { dispatcher, queues } = createOutboxDispatcher(destinationQueueNames);
  let closed = false;
  let dispatching = false;

  /** Dispatches one outbox batch while preventing overlapping timer executions in this process. */
  async function dispatchOutboxBatch(): Promise<void> {
    if (closed || dispatching) return;

    dispatching = true;
    try {
      await dispatcher.dispatchBatch();
    } catch (error) {
      logger.error({ err: error }, "Foundation outbox dispatch failed");
    } finally {
      dispatching = false;
    }
  }

  await dispatchOutboxBatch();
  const timer = setInterval(() => void dispatchOutboxBatch(), OUTBOX_POLL_INTERVAL_MS);
  timer.unref();

  return {
    /** Stops new dispatch attempts and closes all queue producer connections. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await Promise.allSettled(queues.map(async (queue) => queue.close()));
    },
  };
}
