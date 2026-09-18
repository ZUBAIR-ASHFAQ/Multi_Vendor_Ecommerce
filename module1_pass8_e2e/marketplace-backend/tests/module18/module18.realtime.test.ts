import { describe, expect, it, vi } from "vitest";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";

/** Builds the smallest replay-safe repository double needed to exercise realtime publication. */
function createRepositoryDouble() {
  const delivery = {
    id: "11111111-1111-4111-8111-111111111111",
    sourceEventId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    channel: "in_app",
    templateCode: "direct.in_app",
    destinationMasked: "in_app",
    notificationId: "44444444-4444-4444-8444-444444444444",
    status: "queued",
    attempts: 0,
    providerRef: null,
    lastErrorCode: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return {
    delivery,
    repository: {
      findSourceEventById: vi.fn(async () => ({
        id: delivery.sourceEventId,
        eventType: "order.created",
        aggregateType: "order",
        aggregateId: "55555555-5555-4555-8555-555555555555",
        payload: {},
        status: "published",
        attempts: 0,
        availableAt: delivery.createdAt,
        lockedAt: null,
        publishedAt: delivery.createdAt,
        lastError: null,
        createdAt: delivery.createdAt,
      })),
      findDeliveryByEventRecipientChannel: vi.fn(async () => null),
      findUserPreference: vi.fn(async () => null),
      findActiveTemplate: vi.fn(async () => ({
        id: "66666666-6666-4666-8666-666666666666",
        code: "direct.in_app",
        channel: "in_app",
        subjectTemplate: "New notification",
        bodyTemplate: "Please refresh.",
        status: "active",
        version: 1,
        createdAt: delivery.createdAt,
        updatedAt: delivery.createdAt,
      })),
      createDeliveryIfMissing: vi.fn(async () => ({ ...delivery, notificationId: null })),
      createNotification: vi.fn(async () => ({
        id: delivery.notificationId,
        userId: delivery.userId,
        type: "order.created",
        title: "New notification",
        body: "Please refresh.",
        dataJson: {},
        readAt: null,
        createdAt: delivery.createdAt,
      })),
      attachNotificationToDelivery: vi.fn(async () => delivery),
    },
  };
}

describe("Module 18 realtime publication", () => {
  it("publishes only after a new durable in-app notification is prepared", async () => {
    const { repository, delivery } = createRepositoryDouble();
    const publishNotificationCreated = vi.fn();
    const service = new NotificationsService({
      repository: repository as never,
      repositoryUsingTransaction: () => repository as never,
      transactionRunner: async (work) => work({} as never),
      outboxUsingTransaction: () => ({ enqueue: vi.fn(async () => "event") }),
      administrationUsingTransaction: () => ({
        resolveNotificationRecipient: vi.fn(async () => ({
          id: delivery.userId,
          email: "u@example.com",
        })),
      }),
      dispatchPolicy: {
        resolveTargets: vi.fn(async () => [
          {
            userId: delivery.userId,
            channel: "in_app" as const,
            templateCode: "direct.in_app",
            variables: {},
            allowedVariables: [],
          },
        ]),
        isMandatory: () => false,
      },
      realtimePublisher: { publishNotificationCreated },
    });

    await service.dispatchCommittedEvent(delivery.sourceEventId);

    expect(publishNotificationCreated).toHaveBeenCalledOnce();
    expect(publishNotificationCreated).toHaveBeenCalledWith(
      delivery.userId,
      delivery.notificationId,
    );
  });
});
