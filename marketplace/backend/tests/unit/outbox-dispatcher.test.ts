import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxEventRow } from "../../src/database/schema/index.js";
import { OUTBOX_STATUS } from "../../src/common/outbox/outbox.contract.js";
import {
  OutboxDispatcherService,
  type DomainEventPublisher,
} from "../../src/common/outbox/outbox-dispatcher.service.js";
import { OutboxRepository } from "../../src/common/outbox/outbox.repository.js";

/** Creates one complete persistence-shaped outbox row for dispatcher unit tests. */
function outboxRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  const now = new Date("2026-09-08T00:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    eventType: "product.updated",
    aggregateType: "product",
    aggregateId: "product-1",
    payload: { productId: "product-1" },
    headers: { requestId: "request-1" },
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    availableAt: now,
    publishedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Creates a small persistence-only Outbox repository double and exposes its spies to each test. */
function repositoryStub() {
  const findDispatchable = vi.fn();
  const markProcessing = vi.fn();
  const markPublished = vi.fn();
  const markFailed = vi.fn();

  return {
    repository: {
      findDispatchable,
      markProcessing,
      markPublished,
      markFailed,
    } as unknown as OutboxRepository,
    findDispatchable,
    markProcessing,
    markPublished,
    markFailed,
  };
}

/** Creates the provider-neutral event publisher double used by dispatcher tests. */
function publisherStub() {
  const publish = vi.fn();
  return {
    publisher: { publish } as DomainEventPublisher,
    publish,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Foundation outbox dispatcher retry behavior", () => {
  it("marks a successfully published event once after passing the stable event id to the publisher", async () => {
    const pending = outboxRow();
    const claimed = outboxRow({ status: OUTBOX_STATUS.PROCESSING, attempts: 1 });
    const repository = repositoryStub();
    const publisher = publisherStub();
    repository.findDispatchable.mockResolvedValue([pending]);
    repository.markProcessing.mockResolvedValue(claimed);
    repository.markPublished.mockResolvedValue({ ...claimed, status: OUTBOX_STATUS.PUBLISHED });

    const service = new OutboxDispatcherService(repository.repository, publisher.publisher);
    const result = await service.dispatchBatch(new Date("2026-09-08T00:00:00.000Z"));

    expect(result).toEqual({ published: 1, failed: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(claimed.id, {
      eventType: claimed.eventType,
      aggregateType: claimed.aggregateType,
      aggregateId: claimed.aggregateId,
      payload: claimed.payload,
      headers: claimed.headers,
    });
    expect(repository.markPublished).toHaveBeenCalledWith(claimed.id);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("schedules a failed publish for bounded retry and never marks the event published", async () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const pending = outboxRow();
    const claimed = outboxRow({ status: OUTBOX_STATUS.PROCESSING, attempts: 1 });
    const repository = repositoryStub();
    const publisher = publisherStub();
    repository.findDispatchable.mockResolvedValue([pending]);
    repository.markProcessing.mockResolvedValue(claimed);
    repository.markFailed.mockResolvedValue({ ...claimed, status: OUTBOX_STATUS.FAILED });
    publisher.publish.mockRejectedValue(new Error("consumer queue unavailable"));

    const service = new OutboxDispatcherService(repository.repository, publisher.publisher);
    const result = await service.dispatchBatch(now);

    expect(result).toEqual({ published: 0, failed: 1 });
    expect(repository.markPublished).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledTimes(1);

    const [, errorMessage, retryAt] = repository.markFailed.mock.calls[0] ?? [];
    expect(errorMessage).toBe("consumer queue unavailable");
    expect(retryAt).toBeInstanceOf(Date);
    expect((retryAt as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it("skips an event that loses the claim race so two dispatchers cannot publish it together", async () => {
    const pending = outboxRow();
    const repository = repositoryStub();
    const publisher = publisherStub();
    repository.findDispatchable.mockResolvedValue([pending]);
    repository.markProcessing.mockResolvedValue(null);

    const service = new OutboxDispatcherService(repository.repository, publisher.publisher);
    const result = await service.dispatchBatch(new Date("2026-09-08T00:00:00.000Z"));

    expect(result).toEqual({ published: 0, failed: 0 });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(repository.markPublished).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});
