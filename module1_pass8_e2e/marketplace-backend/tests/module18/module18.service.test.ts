import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATIONS_AUDIT_ACTION,
  NOTIFICATIONS_ERROR_CODE,
  NOTIFICATIONS_OUTBOX_EVENT,
  NOTIFICATIONS_PERMISSION,
} from "../../src/modules/notifications/notifications.constants.js";
import { NotificationsRepository } from "../../src/modules/notifications/notifications.repository.js";
import {
  NotificationsService,
  type NotificationDispatchPolicy,
  type NotificationDispatchTarget,
} from "../../src/modules/notifications/notifications.service.js";
import {
  adminNotificationDeliveriesQuerySchema,
  notificationsListQuerySchema,
  updateNotificationPreferencesBodySchema,
} from "../../src/modules/notifications/notifications.schema.js";

/** Clears Module 18 state and its direct user/outbox/audit prerequisites for focused service tests. */
async function resetModule18ServiceTables(): Promise<void> {
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

/** Inserts one minimal active user and returns both the durable id and normalized email. */
async function createServiceUser(label: string): Promise<{ id: string; email: string }> {
  const email = `module18-${label}-${randomUUID()}@example.com`;
  const result = await databasePool.query<{ id: string; email: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status)
     values ($1, 'module18-service-test-hash', $2, 'customer', 'active')
     returning id, email`,
    [email, `Module 18 ${label}`],
  );
  const user = result.rows[0];
  if (!user) throw new Error("Module 18 service user insert did not return a row.");
  return user;
}

/** Inserts one committed source event that the Notification dispatcher is allowed to consume. */
async function createCommittedSourceEvent(
  eventType = "order.created",
  payload: Record<string, unknown> = { orderId: randomUUID() },
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const result = await databasePool.query<{ id: string }>(
    `insert into outbox_events
      (event_type, aggregate_type, aggregate_id, payload, status, published_at)
     values ($1, 'order', $2, $3::jsonb, 'published', now())
     returning id`,
    [eventType, randomUUID(), JSON.stringify(payload)],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 source-event insert did not return an id.");
  return { id, payload };
}

/** Inserts one active template fixture through SQL because template-management HTTP is intentionally not exposed. */
async function createTemplate(
  code: string,
  channel: "in_app" | "email",
  subjectTemplate: string | null,
  bodyTemplate: string,
): Promise<void> {
  await databasePool.query(
    `insert into notification_templates
      (code, channel, subject_template, body_template, status, version)
     values ($1, $2, $3, $4, 'active', 1)`,
    [code, channel, subjectTemplate, bodyTemplate],
  );
}

/** Creates one authenticated request context using only the permissions needed by the tested service command. */
function userContext(
  userId: string,
  permissions: readonly string[],
  actorType: RequestContext["actorType"] = ACTOR_TYPE.CUSTOMER,
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: userId,
    actorType,
    permissions: new Set<PermissionCode>(
      permissions.map((permission) => permission as PermissionCode),
    ),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Returns one stable AppError from a rejected service operation for code/status assertions. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Module 18 service operation to reject.");
}

/** Creates an explicit source-event policy without adding production event mappings before the runtime integration pass. */
function dispatchPolicy(
  targets: readonly NotificationDispatchTarget[],
  mandatory: ReadonlySet<string> = new Set(),
): NotificationDispatchPolicy {
  return {
    /** Returns the test-owned target list for one committed source event. */
    async resolveTargets() {
      return targets;
    },
    /** Uses event/channel pairs such as payment.failed:email as the mandatory-policy key. */
    isMandatory(eventCode, channel) {
      return mandatory.has(`${eventCode}:${channel}`);
    },
  };
}

/** Reads one scalar count from PostgreSQL without coupling assertions to Drizzle implementation details. */
async function countRows(sql: string, values: unknown[] = []): Promise<number> {
  const result = await databasePool.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

beforeEach(async () => {
  await resetModule18ServiceTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 18 Notifications service invariants", () => {
  it("keeps read state owner-scoped and emits notification.read only for real state changes", async () => {
    const repository = new NotificationsRepository();
    const owner = await createServiceUser("read-owner");
    const other = await createServiceUser("read-other");
    const first = await repository.createNotification({
      userId: owner.id,
      type: "order.created",
      title: "Order created",
      body: "Your order was created.",
    });
    const second = await repository.createNotification({
      userId: owner.id,
      type: "payment.captured",
      title: "Payment captured",
      body: "Your payment was captured.",
    });
    const foreign = await repository.createNotification({
      userId: other.id,
      type: "order.created",
      title: "Other order",
      body: "Private to another user.",
    });
    const service = new NotificationsService();
    const context = userContext(owner.id, [NOTIFICATIONS_PERMISSION.READ_OWN]);

    const page = await service.listNotifications(
      context,
      notificationsListQuerySchema.parse({ page: 1, pageSize: 20 }),
    );
    expect(page.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(page.meta).toMatchObject({ totalItems: 2, unreadCount: 2 });

    const foreignError = await rejectedAppError(
      service.markNotificationRead(context, foreign.id),
    );
    expect(foreignError.code).toBe(NOTIFICATIONS_ERROR_CODE.NOT_FOUND);

    const firstRead = await service.markNotificationRead(context, first.id);
    const replay = await service.markNotificationRead(context, first.id);
    expect(replay).toEqual(firstRead);
    expect(
      await countRows(`select count(*)::text as count from outbox_events where event_type = $1`, [
        NOTIFICATIONS_OUTBOX_EVENT.READ,
      ]),
    ).toBe(1);

    await expect(service.markAllNotificationsRead(context)).resolves.toEqual({ updatedCount: 1 });
    await expect(service.markAllNotificationsRead(context)).resolves.toEqual({ updatedCount: 0 });
    expect(
      await countRows(`select count(*)::text as count from outbox_events where event_type = $1`, [
        NOTIFICATIONS_OUTBOX_EVENT.READ,
      ]),
    ).toBe(2);
  });

  it("atomically replaces own preferences and refuses to disable a policy-mandatory channel", async () => {
    const user = await createServiceUser("preferences");
    const policy = dispatchPolicy([], new Set(["payment.failed:email"]));
    const service = new NotificationsService({ dispatchPolicy: policy });
    const context = userContext(user.id, [NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN]);

    const blocked = updateNotificationPreferencesBodySchema.parse({
      preferences: [{ eventCode: "payment.failed", channel: "email", enabled: false }],
    });
    const blockedError = await rejectedAppError(service.updatePreferences(context, blocked));
    expect(blockedError.code).toBe(NOTIFICATIONS_ERROR_CODE.SCOPE_FORBIDDEN);

    const editable = updateNotificationPreferencesBodySchema.parse({
      preferences: [
        { eventCode: "order.created", channel: "email", enabled: false },
        { eventCode: "order.created", channel: "in_app", enabled: true },
      ],
    });
    await expect(service.updatePreferences(context, editable)).resolves.toEqual(
      editable.preferences,
    );
    await expect(service.getPreferences(context)).resolves.toEqual(editable.preferences);
  });

  it("prepares in-app delivery once, honors optional email preferences, and replays idempotently", async () => {
    const repository = new NotificationsRepository();
    const user = await createServiceUser("dispatch");
    const orderId = randomUUID();
    const source = await createCommittedSourceEvent("order.created", { orderId });
    await createTemplate(
      "order.created.in_app",
      NOTIFICATION_CHANNEL.IN_APP,
      "Order {{orderId}}",
      "Your order {{orderId}} was created.",
    );
    await createTemplate(
      "order.created.email",
      NOTIFICATION_CHANNEL.EMAIL,
      "Order {{orderId}}",
      "Your order {{orderId}} was created.",
    );
    await repository.replaceUserPreferences(user.id, [
      { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.EMAIL, enabled: false },
    ]);

    const variables = { orderId };
    const service = new NotificationsService({
      dispatchPolicy: dispatchPolicy([
        {
          userId: user.id,
          channel: NOTIFICATION_CHANNEL.IN_APP,
          templateCode: "order.created.in_app",
          variables,
          allowedVariables: ["orderId"],
          data: { orderId },
        },
        {
          userId: user.id,
          channel: NOTIFICATION_CHANNEL.EMAIL,
          templateCode: "order.created.email",
          variables,
          allowedVariables: ["orderId"],
        },
      ]),
    });

    const first = await service.dispatchCommittedEvent(source.id);
    const replay = await service.dispatchCommittedEvent(source.id);
    expect(first).toMatchObject({ preparedCount: 1, replayedCount: 0, skippedCount: 1 });
    expect(replay).toMatchObject({ preparedCount: 0, replayedCount: 1, skippedCount: 1 });
    expect(
      await countRows(`select count(*)::text as count from notifications where user_id = $1`, [user.id]),
    ).toBe(1);
    expect(
      await countRows(`select count(*)::text as count from notification_deliveries where user_id = $1`, [
        user.id,
      ]),
    ).toBe(1);
    expect(
      await countRows(`select count(*)::text as count from outbox_events where event_type = $1`, [
        NOTIFICATIONS_OUTBOX_EVENT.QUEUED,
      ]),
    ).toBe(1);
  });

  it("lets a mandatory target override an older disabled preference while persisting only a masked email destination", async () => {
    const repository = new NotificationsRepository();
    const user = await createServiceUser("mandatory");
    const paymentId = randomUUID();
    const source = await createCommittedSourceEvent("payment.failed", { paymentId });
    await createTemplate(
      "payment.failed.email",
      NOTIFICATION_CHANNEL.EMAIL,
      "Payment issue",
      "Payment {{paymentId}} needs attention.",
    );
    await repository.replaceUserPreferences(user.id, [
      { eventCode: "payment.failed", channel: NOTIFICATION_CHANNEL.EMAIL, enabled: false },
    ]);

    const service = new NotificationsService({
      dispatchPolicy: dispatchPolicy(
        [
          {
            userId: user.id,
            channel: NOTIFICATION_CHANNEL.EMAIL,
            templateCode: "payment.failed.email",
            variables: { paymentId },
            allowedVariables: ["paymentId"],
            mandatory: true,
          },
        ],
        new Set(["payment.failed:email"]),
      ),
    });

    await expect(service.dispatchCommittedEvent(source.id)).resolves.toMatchObject({
      preparedCount: 1,
      skippedCount: 0,
    });
    const result = await databasePool.query<{ destination_masked: string }>(
      `select destination_masked from notification_deliveries where source_event_id = $1`,
      [source.id],
    );
    expect(result.rows[0]?.destination_masked).toMatch(/^m\*\*\*@example\.com$/u);
    expect(result.rows[0]?.destination_masked).not.toContain(user.email);
  });

  it("rejects missing or non-allow-listed template variables before any delivery is persisted", async () => {
    const user = await createServiceUser("template-policy");
    const source = await createCommittedSourceEvent("order.created");
    await createTemplate(
      "order.created.in_app",
      NOTIFICATION_CHANNEL.IN_APP,
      "Order {{orderId}}",
      "Secret {{secretToken}}",
    );
    const service = new NotificationsService({
      dispatchPolicy: dispatchPolicy([
        {
          userId: user.id,
          channel: NOTIFICATION_CHANNEL.IN_APP,
          templateCode: "order.created.in_app",
          variables: { orderId: randomUUID() },
          allowedVariables: ["orderId"],
        },
      ]),
    });

    const error = await rejectedAppError(service.dispatchCommittedEvent(source.id));
    expect(error.code).toBe(NOTIFICATIONS_ERROR_CODE.TEMPLATE_MISSING);
    expect(
      await countRows(`select count(*)::text as count from notification_deliveries`),
    ).toBe(0);
    expect(await countRows(`select count(*)::text as count from notifications`)).toBe(0);
  });

  it("requeues failed delivery once with privileged audit/outbox evidence and makes duplicate retries harmless", async () => {
    const repository = new NotificationsRepository();
    const user = await createServiceUser("retry-recipient");
    const admin = await createServiceUser("retry-admin");
    const source = await createCommittedSourceEvent("payment.failed");
    const failed = await repository.createDeliveryIfMissing({
      sourceEventId: source.id,
      userId: user.id,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      templateCode: "payment.failed.email",
      destinationMasked: "m***@example.com",
      status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      attempts: 2,
      lastErrorCode: "PROVIDER_TIMEOUT",
    });
    if (!failed) throw new Error("Expected failed delivery fixture to be inserted.");

    const service = new NotificationsService();
    const adminContext = userContext(
      admin.id,
      [NOTIFICATIONS_PERMISSION.ADMIN_READ, NOTIFICATIONS_PERMISSION.ADMIN_RETRY],
      ACTOR_TYPE.PLATFORM_ADMIN,
    );
    const page = await service.listFailedDeliveries(
      adminContext,
      adminNotificationDeliveriesQuerySchema.parse({ page: 1, pageSize: 20 }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: failed.id, destinationMasked: "m***@example.com" });

    const firstRetry = await service.retryFailedDelivery(adminContext, failed.id);
    const replay = await service.retryFailedDelivery(adminContext, failed.id);
    expect(firstRetry).toMatchObject({
      id: failed.id,
      status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
      attempts: 2,
      providerRef: null,
      lastErrorCode: null,
    });
    expect(replay).toEqual(firstRetry);
    expect(
      await countRows(`select count(*)::text as count from audit_logs where action = $1`, [
        NOTIFICATIONS_AUDIT_ACTION.DELIVERY_RETRY_REQUESTED,
      ]),
    ).toBe(1);
    expect(
      await countRows(`select count(*)::text as count from outbox_events where event_type = $1`, [
        NOTIFICATIONS_OUTBOX_EVENT.QUEUED,
      ]),
    ).toBe(1);

    const noPermission = userContext(admin.id, [], ACTOR_TYPE.PLATFORM_ADMIN);
    const permissionError = await rejectedAppError(
      service.retryFailedDelivery(noPermission, failed.id),
    );
    expect(permissionError.code).toBe(ERROR_CODE.FORBIDDEN);
  });
});
