import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../../src/common/jobs/queue.factory.js";
import {
  NOTIFICATIONS_JOB,
  NOTIFICATIONS_OUTBOX_EVENT,
} from "../../src/modules/notifications/notifications.constants.js";
import {
  startNotificationsRuntime,
  type NotificationsJobProcessor,
} from "../../src/modules/notifications/notifications.jobs.js";

vi.mock("../../src/common/jobs/queue.factory.js", () => ({
  createWorker: vi.fn(),
}));

interface FakeJob<TData> {
  id?: string;
  attemptsMade: number;
  opts: { attempts?: number };
  data: TData;
}

type FakeProcessor<TData> = (job: FakeJob<TData>) => Promise<unknown>;

let capturedProcessor: FakeProcessor<unknown>;
const worker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

/** Builds one Foundation-style committed domain-event queue job. */
function sourceJob(eventType: string, aggregateId = "aggregate-1") {
  return {
    id: `job-${eventType}`,
    attemptsMade: 0,
    opts: { attempts: 5 },
    data: {
      eventId: `event-${eventType}`,
      event: {
        eventType,
        aggregateType: "test",
        aggregateId,
        payload: {},
      },
    },
  };
}

/** Returns one processor double with every runtime method observable. */
function processorDouble(): NotificationsJobProcessor {
  return {
    ensureDefaultTemplates: vi.fn().mockResolvedValue(undefined),
    dispatchCommittedEvent: vi.fn().mockResolvedValue({}),
    processQueuedDelivery: vi.fn().mockResolvedValue(undefined),
    recordDeliveryFailure: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  worker.on.mockClear();
  worker.close.mockClear();
  vi.mocked(createWorker).mockImplementation(((name, processor) => {
    expect(name).toBe(NOTIFICATIONS_JOB.SOURCE_EVENT_QUEUE);
    capturedProcessor = processor as unknown as FakeProcessor<unknown>;
    return worker as never;
  }) as typeof createWorker);
});

describe("Module 18 Notification BullMQ runtime", () => {
  it("bootstraps templates, dispatches source events, ignores terminal Notification events, and closes once", async () => {
    const processor = processorDouble();
    const runtime = await startNotificationsRuntime(processor);

    expect(processor.ensureDefaultTemplates).toHaveBeenCalledTimes(1);
    await capturedProcessor(sourceJob("order.created") as never);
    await capturedProcessor(sourceJob(NOTIFICATIONS_OUTBOX_EVENT.SENT) as never);

    expect(processor.dispatchCommittedEvent).toHaveBeenCalledTimes(1);
    expect(processor.dispatchCommittedEvent).toHaveBeenCalledWith("event-order.created");
    expect(processor.processQueuedDelivery).not.toHaveBeenCalled();

    await runtime.close();
    await runtime.close();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it("routes notification.queued to delivery execution and persists retryable/final failure state", async () => {
    const processor = processorDouble();
    vi.mocked(processor.processQueuedDelivery).mockRejectedValue(new Error("provider unavailable"));
    await startNotificationsRuntime(processor);

    const retrying = sourceJob(NOTIFICATIONS_OUTBOX_EVENT.QUEUED, "delivery-1");
    retrying.attemptsMade = 1;
    await expect(capturedProcessor(retrying as never)).rejects.toThrow("provider unavailable");
    expect(processor.recordDeliveryFailure).toHaveBeenLastCalledWith(
      "delivery-1",
      "NOTIFICATION_DELIVERY_FAILED",
      false,
    );

    const finalAttempt = sourceJob(NOTIFICATIONS_OUTBOX_EVENT.QUEUED, "delivery-2");
    finalAttempt.attemptsMade = 4;
    await expect(capturedProcessor(finalAttempt as never)).rejects.toThrow("provider unavailable");
    expect(processor.recordDeliveryFailure).toHaveBeenLastCalledWith(
      "delivery-2",
      "NOTIFICATION_DELIVERY_FAILED",
      true,
    );
  });
});
