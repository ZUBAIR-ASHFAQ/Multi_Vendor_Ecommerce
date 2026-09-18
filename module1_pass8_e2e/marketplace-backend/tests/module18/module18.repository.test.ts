import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
} from "../../src/modules/notifications/notifications.constants.js";
import { NotificationsRepository } from "../../src/modules/notifications/notifications.repository.js";
import {
  adminNotificationDeliveriesQuerySchema,
  notificationsListQuerySchema,
} from "../../src/modules/notifications/notifications.schema.js";

/** Clears Module 18 persistence plus its direct user/outbox prerequisites for focused repository tests. */
async function resetModule18RepositoryTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      notification_deliveries,
      notification_preferences,
      notifications,
      notification_templates,
      outbox_events,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** Inserts one minimal active user without invoking Authentication business logic. */
async function createRepositoryUser(label: string): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status)
     values ($1, 'module18-repository-test-hash', $2, 'customer', 'active')
     returning id`,
    [`module18-${label}-${randomUUID()}@example.com`, `Module 18 ${label}`],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 repository user insert did not return an id.");
  return id;
}

/** Inserts one committed source-event row so delivery foreign-key/idempotency behavior can be tested. */
async function createSourceEvent(eventType = "order.created"): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into outbox_events
      (event_type, aggregate_type, aggregate_id, payload, status, published_at)
     values ($1, 'order', $2, $3::jsonb, 'published', now())
     returning id`,
    [eventType, randomUUID(), JSON.stringify({ orderId: randomUUID() })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 source-event insert did not return an id.");
  return id;
}

/** Inserts one versioned Notification template fixture without adding template-management behavior to the repository. */
async function createActiveTemplate(code: string, channel: string): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into notification_templates
      (code, channel, subject_template, body_template, status, version)
     values ($1, $2, 'Subject {{orderId}}', 'Body {{orderId}}', 'active', 1)
     returning id`,
    [code, channel],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 template insert did not return an id.");
  return id;
}

beforeEach(async () => {
  await resetModule18RepositoryTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 18 Notifications repository boundaries", () => {
  it("keeps Notification reads and read-state writes inside the owning user scope", async () => {
    const repository = new NotificationsRepository();
    const ownerA = await createRepositoryUser("owner-a");
    const ownerB = await createRepositoryUser("owner-b");

    const firstA = await repository.createNotification({
      userId: ownerA,
      type: "order.created",
      title: "Order created",
      body: "Your order was created.",
      dataJson: { orderId: randomUUID() },
      createdAt: new Date("2026-09-16T08:00:00.000Z"),
    });
    const secondA = await repository.createNotification({
      userId: ownerA,
      type: "payment.captured",
      title: "Payment received",
      body: "Your payment was captured.",
      createdAt: new Date("2026-09-16T08:01:00.000Z"),
    });
    const onlyB = await repository.createNotification({
      userId: ownerB,
      type: "order.created",
      title: "Other customer's order",
      body: "This row belongs to another user.",
      createdAt: new Date("2026-09-16T08:02:00.000Z"),
    });

    const query = notificationsListQuerySchema.parse({ page: 1, pageSize: 20 });
    const pageA = await repository.listOwnedNotifications(ownerA, query);
    expect(pageA.totalItems).toBe(2);
    expect(pageA.unreadCount).toBe(2);
    expect(pageA.items.map((row) => row.id)).toEqual([secondA.id, firstA.id]);
    expect(pageA.items.some((row) => row.id === onlyB.id)).toBe(false);

    await expect(repository.findOwnedNotificationById(onlyB.id, ownerA)).resolves.toBeNull();
    await expect(
      repository.markOwnedNotificationRead(onlyB.id, ownerA, new Date()),
    ).resolves.toBeNull();

    const readAt = new Date("2026-09-16T08:03:00.000Z");
    await expect(repository.markOwnedNotificationRead(firstA.id, ownerA, readAt)).resolves.toMatchObject({
      id: firstA.id,
      userId: ownerA,
      readAt,
    });
    await expect(repository.markOwnedNotificationRead(firstA.id, ownerA, new Date())).resolves.toBeNull();

    const afterOne = await repository.listOwnedNotifications(ownerA, query);
    expect(afterOne.unreadCount).toBe(1);
    await expect(
      repository.markAllOwnedNotificationsRead(ownerA, new Date("2026-09-16T08:04:00.000Z")),
    ).resolves.toBe(1);
    await expect(repository.listOwnedNotifications(ownerA, query)).resolves.toMatchObject({
      totalItems: 2,
      unreadCount: 0,
    });
    await expect(repository.listOwnedNotifications(ownerB, query)).resolves.toMatchObject({
      totalItems: 1,
      unreadCount: 1,
    });
  });

  it("replaces and reads preferences only inside the requested user scope", async () => {
    const repository = new NotificationsRepository();
    const ownerA = await createRepositoryUser("preferences-a");
    const ownerB = await createRepositoryUser("preferences-b");

    await repository.replaceUserPreferences(ownerA, [
      { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.EMAIL, enabled: true },
      { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.IN_APP, enabled: false },
    ]);
    await repository.replaceUserPreferences(ownerB, [
      { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.EMAIL, enabled: false },
    ]);

    await expect(repository.listUserPreferences(ownerA)).resolves.toEqual([
      expect.objectContaining({
        userId: ownerA,
        eventCode: "order.created",
        channel: NOTIFICATION_CHANNEL.EMAIL,
        enabled: true,
      }),
      expect.objectContaining({
        userId: ownerA,
        eventCode: "order.created",
        channel: NOTIFICATION_CHANNEL.IN_APP,
        enabled: false,
      }),
    ]);
    await expect(
      repository.findUserPreference(ownerA, "order.created", NOTIFICATION_CHANNEL.EMAIL),
    ).resolves.toMatchObject({ userId: ownerA, enabled: true });
    await expect(
      repository.findUserPreference(ownerA, "order.created", NOTIFICATION_CHANNEL.IN_APP),
    ).resolves.toMatchObject({ userId: ownerA, enabled: false });

    await repository.replaceUserPreferences(ownerA, [
      { eventCode: "payment.captured", channel: NOTIFICATION_CHANNEL.IN_APP, enabled: true },
    ]);
    await expect(repository.listUserPreferences(ownerA)).resolves.toEqual([
      expect.objectContaining({
        eventCode: "payment.captured",
        channel: NOTIFICATION_CHANNEL.IN_APP,
        enabled: true,
      }),
    ]);
    await expect(repository.listUserPreferences(ownerB)).resolves.toHaveLength(1);
  });

  it("resolves active templates and makes delivery creation idempotent by event/recipient/channel", async () => {
    const repository = new NotificationsRepository();
    const userId = await createRepositoryUser("delivery");
    const sourceEventId = await createSourceEvent();
    const templateId = await createActiveTemplate("order.created", NOTIFICATION_CHANNEL.IN_APP);

    await expect(
      repository.findActiveTemplate("order.created", NOTIFICATION_CHANNEL.IN_APP),
    ).resolves.toMatchObject({ id: templateId, status: "active", version: 1 });
    await expect(
      repository.findActiveTemplate("order.created", NOTIFICATION_CHANNEL.EMAIL),
    ).resolves.toBeNull();
    await expect(repository.findSourceEventById(sourceEventId)).resolves.toMatchObject({
      id: sourceEventId,
      eventType: "order.created",
      status: "published",
    });

    const notification = await repository.createNotification({
      userId,
      type: "order.created",
      title: "Order created",
      body: "Your order was created.",
    });
    const input = {
      notificationId: notification.id,
      sourceEventId,
      userId,
      channel: NOTIFICATION_CHANNEL.IN_APP,
      templateCode: "order.created",
      destinationMasked: "in-app",
    } as const;

    const first = await repository.createDeliveryIfMissing({ ...input, notificationId: null });
    const duplicate = await repository.createDeliveryIfMissing({ ...input, notificationId: null });
    expect(first).toMatchObject({
      sourceEventId,
      userId,
      channel: NOTIFICATION_CHANNEL.IN_APP,
      notificationId: null,
      status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
      attempts: 0,
    });
    expect(duplicate).toBeNull();
    if (!first) throw new Error("Expected the first delivery insert to succeed.");

    await expect(
      repository.attachNotificationToDelivery(first.id, notification.id),
    ).resolves.toMatchObject({ id: first.id, notificationId: notification.id });
    await expect(
      repository.attachNotificationToDelivery(first.id, notification.id),
    ).resolves.toBeNull();
    await expect(
      repository.findDeliveryByEventRecipientChannel(
        sourceEventId,
        userId,
        NOTIFICATION_CHANNEL.IN_APP,
      ),
    ).resolves.toMatchObject({ id: first.id, notificationId: notification.id });
  });

  it("lists only failed deliveries with masked destinations and persists locked retry state", async () => {
    const repository = new NotificationsRepository();
    const userId = await createRepositoryUser("admin-queue");
    const failedSourceId = await createSourceEvent("payment.failed");
    const sentSourceId = await createSourceEvent("order.created");

    const failed = await repository.createDeliveryIfMissing({
      sourceEventId: failedSourceId,
      userId,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      templateCode: "payment.failed",
      destinationMasked: "a***@example.com",
      status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      attempts: 2,
      lastErrorCode: "PROVIDER_TIMEOUT",
    });
    await repository.createDeliveryIfMissing({
      sourceEventId: sentSourceId,
      userId,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      templateCode: "order.created",
      destinationMasked: "a***@example.com",
      status: NOTIFICATION_DELIVERY_STATUS.SENT,
      attempts: 1,
      providerRef: "provider-safe-ref",
    });
    if (!failed) throw new Error("Expected failed delivery fixture to be inserted.");

    const query = adminNotificationDeliveriesQuerySchema.parse({ page: 1, pageSize: 20 });
    const page = await repository.listFailedDeliveries(query);
    expect(page.totalItems).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: failed.id,
      userId,
      destinationMasked: "a***@example.com",
      status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      attempts: 2,
      lastErrorCode: "PROVIDER_TIMEOUT",
    });
    expect(page.items[0]).not.toHaveProperty("sourceEventId");
    expect(page.items[0]).not.toHaveProperty("destination");

    await db.transaction(async (transaction) => {
      const scopedRepository = repository.using(transaction);
      const locked = await scopedRepository.findDeliveryByIdForUpdate(failed.id);
      expect(locked).toMatchObject({ id: failed.id, status: NOTIFICATION_DELIVERY_STATUS.FAILED });

      await expect(
        scopedRepository.updateDeliveryState(failed.id, {
          status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
          attempts: locked?.attempts ?? 2,
          providerRef: null,
          lastErrorCode: null,
          updatedAt: new Date("2026-09-16T08:05:00.000Z"),
        }),
      ).resolves.toMatchObject({
        id: failed.id,
        status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
        lastErrorCode: null,
      });
    });

    await expect(repository.listFailedDeliveries(query)).resolves.toMatchObject({
      items: [],
      totalItems: 0,
    });
  });
});
