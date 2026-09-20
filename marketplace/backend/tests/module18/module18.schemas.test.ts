import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_TEMPLATE_STATUS,
  NOTIFICATIONS_ERROR_CODE,
  NOTIFICATIONS_OUTBOX_EVENT,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_PERMISSION,
} from "../../src/modules/notifications/notifications.constants.js";
import {
  adminNotificationDeliveriesQuerySchema,
  adminNotificationDeliveryResponseSchema,
  markAllNotificationsReadBodySchema,
  markNotificationReadBodySchema,
  notificationIdParamsSchema,
  notificationsListQuerySchema,
  retryNotificationDeliveryBodySchema,
  updateNotificationPreferencesBodySchema,
} from "../../src/modules/notifications/notifications.schema.js";

const ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-09-16T00:00:00.000Z";

describe("Module 18 fixed contract values", () => {
  it("keeps source-defined channels, lifecycle values, permissions, errors, and events", () => {
    expect(Object.values(NOTIFICATION_CHANNEL)).toEqual(["in_app", "email"]);
    expect(Object.values(NOTIFICATION_TEMPLATE_STATUS)).toEqual(["active", "inactive"]);
    expect(Object.values(NOTIFICATION_DELIVERY_STATUS)).toEqual([
      "queued",
      "processing",
      "sent",
      "failed",
    ]);
    expect(Object.values(NOTIFICATIONS_PERMISSION)).toEqual([
      "notifications.read_own",
      "notifications.preferences.manage_own",
      "admin.notifications.read",
      "admin.notifications.retry",
    ]);
    expect(Object.values(NOTIFICATIONS_ERROR_CODE)).toEqual([
      "NOTIFICATION_NOT_FOUND",
      "NOTIFICATION_TEMPLATE_MISSING",
      "NOTIFICATION_DELIVERY_FAILED",
      "NOTIFICATION_SCOPE_FORBIDDEN",
    ]);
    expect(Object.values(NOTIFICATIONS_OUTBOX_EVENT)).toEqual([
      "notification.queued",
      "notification.sent",
      "notification.failed",
      "notification.read",
    ]);
  });

  it("freezes exactly the seven documented Module 18 routes", () => {
    expect(Object.values(NOTIFICATIONS_PATH)).toEqual([
      "/api/v1/notifications",
      "/api/v1/notifications/:id/read",
      "/api/v1/notifications/read-all",
      "/api/v1/notifications/preferences",
      "/api/v1/notifications/preferences",
      "/api/v1/admin/notification-deliveries",
      "/api/v1/admin/notification-deliveries/:id/retry",
    ]);
    expect(Object.keys(NOTIFICATIONS_PATH)).toHaveLength(7);
    // GET and PUT preferences are separate operations on the same exact HTTP path.
  });
});

describe("Module 18 request boundaries", () => {
  it("accepts only bounded pagination for user and admin list queries", () => {
    expect(notificationsListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(adminNotificationDeliveriesQuerySchema.parse({ page: "2", pageSize: "10" })).toEqual({
      page: 2,
      pageSize: 10,
    });
    expect(() => notificationsListQuerySchema.parse({ status: "failed" })).toThrow();
    expect(() => adminNotificationDeliveriesQuerySchema.parse({ userId: ID })).toThrow();
  });

  it("keeps read/retry commands replay-safe and server-owned", () => {
    expect(markNotificationReadBodySchema.parse(undefined)).toEqual({});
    expect(markAllNotificationsReadBodySchema.parse(undefined)).toEqual({});
    expect(retryNotificationDeliveryBodySchema.parse(undefined)).toEqual({});
    expect(notificationIdParamsSchema.parse({ id: ID })).toEqual({ id: ID });
    expect(() => markNotificationReadBodySchema.parse({ readAt: NOW })).toThrow();
    expect(() => retryNotificationDeliveryBodySchema.parse({ providerRef: "secret" })).toThrow();
  });

  it("normalizes preferences, rejects duplicate event/channel entries, and never accepts user identity", () => {
    expect(
      updateNotificationPreferencesBodySchema.parse({
        preferences: [
          { eventCode: " ORDER.CREATED ", channel: "email", enabled: true },
          { eventCode: "order.created", channel: "in_app", enabled: false },
        ],
      }),
    ).toEqual({
      preferences: [
        { eventCode: "order.created", channel: "email", enabled: true },
        { eventCode: "order.created", channel: "in_app", enabled: false },
      ],
    });

    expect(() =>
      updateNotificationPreferencesBodySchema.parse({
        preferences: [
          { eventCode: "order.created", channel: "email", enabled: true },
          { eventCode: "ORDER.CREATED", channel: "email", enabled: false },
        ],
      }),
    ).toThrow();

    expect(() =>
      updateNotificationPreferencesBodySchema.parse({
        userId: ID,
        preferences: [],
      }),
    ).toThrow();
  });
});

describe("Module 18 privacy-safe admin delivery boundary", () => {
  it("accepts only masked destination/provider result fields", () => {
    const parsed = adminNotificationDeliveryResponseSchema.parse({
      id: ID,
      notificationId: null,
      userId: ID,
      channel: "email",
      templateCode: "order.created",
      destinationMasked: "a***@example.com",
      status: "failed",
      attempts: 2,
      providerRef: null,
      lastErrorCode: "PROVIDER_TIMEOUT",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.destinationMasked).toBe("a***@example.com");
    expect(() =>
      adminNotificationDeliveryResponseSchema.parse({
        ...parsed,
        destination: "alice@example.com",
      }),
    ).toThrow();
  });
});
