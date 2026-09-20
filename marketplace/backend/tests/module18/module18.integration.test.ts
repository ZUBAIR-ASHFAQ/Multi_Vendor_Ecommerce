import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import type { NotificationEmailProvider } from "../../src/integrations/email/notification-email-provider.contract.js";
import {
  NotificationEmailProviderError,
} from "../../src/integrations/email/notification-email-provider.contract.js";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATIONS_OUTBOX_EVENT,
  NOTIFICATIONS_PROVIDER_ERROR_CODE,
} from "../../src/modules/notifications/notifications.constants.js";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";

/** Clears only Module 18 and its direct identity/outbox prerequisites for runtime integration tests. */
async function resetNotificationRuntimeTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      notification_deliveries,
      notification_preferences,
      notifications,
      notification_templates,
      audit_logs,
      outbox_events,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** Inserts one active recipient identity without involving unrelated authentication behavior. */
async function createRecipient(): Promise<{ id: string; email: string }> {
  const email = `module18-runtime-${randomUUID()}@example.com`;
  const result = await databasePool.query<{ id: string; email: string }>(
    `insert into users (email, password_hash, display_name, account_type, status)
     values ($1, 'module18-runtime-hash', 'Module 18 Runtime User', 'customer', 'active')
     returning id, email`,
    [email],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Module 18 runtime recipient insert did not return a row.");
  return row;
}

/** Inserts one published order.created source event supported by the built-in direct-recipient policy. */
async function createOrderCreatedEvent(userId: string): Promise<string> {
  const orderId = randomUUID();
  const result = await databasePool.query<{ id: string }>(
    `insert into outbox_events
      (event_type, aggregate_type, aggregate_id, payload, status, published_at)
     values ('order.created', 'order', $1, $2::jsonb, 'published', now())
     returning id`,
    [orderId, JSON.stringify({ orderId, orderNo: "ORD-M18-001", customerUserId: userId })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 source event insert did not return an id.");
  return id;
}

/** Reads one delivery state directly for provider/worker reconciliation assertions. */
async function readDelivery(sourceEventId: string, channel: string) {
  const result = await databasePool.query<{
    id: string;
    status: string;
    attempts: number;
    provider_ref: string | null;
    last_error_code: string | null;
  }>(
    `select id, status, attempts, provider_ref, last_error_code
       from notification_deliveries
      where source_event_id = $1 and channel = $2`,
    [sourceEventId, channel],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Module 18 ${channel} delivery was not found.`);
  return row;
}

/** Counts one durable Notification lifecycle event for one delivery aggregate. */
async function countLifecycleEvent(eventType: string, deliveryId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from outbox_events
      where event_type = $1 and aggregate_id = $2`,
    [eventType, deliveryId],
  );
  return result.rows[0]?.count ?? 0;
}

beforeEach(async () => {
  await resetNotificationRuntimeTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 18 Notification runtime integration", () => {
  it("dispatches one real order.created event to in-app/email and sends each delivery exactly once", async () => {
    const recipient = await createRecipient();
    const sourceEventId = await createOrderCreatedEvent(recipient.id);
    const sendEmail = vi.fn().mockImplementation(async (input: { idempotencyKey: string }) => ({
      providerRef: `provider:${input.idempotencyKey}`,
    }));
    const emailProvider: NotificationEmailProvider = { sendEmail };
    const service = new NotificationsService({ emailProvider });

    await service.ensureDefaultTemplates();
    await expect(service.dispatchCommittedEvent(sourceEventId)).resolves.toMatchObject({
      preparedCount: 2,
      replayedCount: 0,
      skippedCount: 0,
    });

    const inApp = await readDelivery(sourceEventId, NOTIFICATION_CHANNEL.IN_APP);
    const email = await readDelivery(sourceEventId, NOTIFICATION_CHANNEL.EMAIL);
    await service.processQueuedDelivery(inApp.id);
    await service.processQueuedDelivery(email.id);
    await service.processQueuedDelivery(email.id);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: recipient.email,
      subject: "Order placed",
      idempotencyKey: email.id,
    }));
    await expect(readDelivery(sourceEventId, NOTIFICATION_CHANNEL.IN_APP)).resolves.toMatchObject({
      status: NOTIFICATION_DELIVERY_STATUS.SENT,
      attempts: 1,
    });
    await expect(readDelivery(sourceEventId, NOTIFICATION_CHANNEL.EMAIL)).resolves.toMatchObject({
      status: NOTIFICATION_DELIVERY_STATUS.SENT,
      attempts: 1,
      provider_ref: `provider:${email.id}`,
    });
    expect(await countLifecycleEvent(NOTIFICATIONS_OUTBOX_EVENT.SENT, inApp.id)).toBe(1);
    expect(await countLifecycleEvent(NOTIFICATIONS_OUTBOX_EVENT.SENT, email.id)).toBe(1);
  });

  it("keeps provider failures retryable and emits notification.failed only on the final attempt", async () => {
    const recipient = await createRecipient();
    const sourceEventId = await createOrderCreatedEvent(recipient.id);
    const emailProvider: NotificationEmailProvider = {
      /** Simulates one provider outage without exposing provider response content. */
      async sendEmail() {
        throw new NotificationEmailProviderError(
          NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
          "Provider unavailable.",
        );
      },
    };
    const service = new NotificationsService({ emailProvider });
    await service.ensureDefaultTemplates();
    await service.dispatchCommittedEvent(sourceEventId);
    const email = await readDelivery(sourceEventId, NOTIFICATION_CHANNEL.EMAIL);

    await expect(service.processQueuedDelivery(email.id)).rejects.toMatchObject({
      code: NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
    });
    await service.recordDeliveryFailure(
      email.id,
      NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
      false,
    );
    await expect(readDelivery(sourceEventId, NOTIFICATION_CHANNEL.EMAIL)).resolves.toMatchObject({
      status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
      attempts: 1,
      last_error_code: NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
    });
    expect(await countLifecycleEvent(NOTIFICATIONS_OUTBOX_EVENT.FAILED, email.id)).toBe(0);

    await expect(service.processQueuedDelivery(email.id)).rejects.toBeInstanceOf(
      NotificationEmailProviderError,
    );
    await service.recordDeliveryFailure(
      email.id,
      NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
      true,
    );
    await expect(readDelivery(sourceEventId, NOTIFICATION_CHANNEL.EMAIL)).resolves.toMatchObject({
      status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      attempts: 2,
      last_error_code: NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
    });
    expect(await countLifecycleEvent(NOTIFICATIONS_OUTBOX_EVENT.FAILED, email.id)).toBe(1);
  });
});
