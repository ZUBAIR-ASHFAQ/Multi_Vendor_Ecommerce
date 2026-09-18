import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATIONS_ERROR_CODE,
} from "../../src/modules/notifications/notifications.constants.js";
import { NotificationsRepository } from "../../src/modules/notifications/notifications.repository.js";
import {
  bearer,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
  resetModule4Tables,
} from "../module4/module4.test-helpers.js";

/** Clears Notification FK dependents before resetting the released identity/RBAC fixture state. */
async function resetModule18HttpTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      notification_deliveries,
      notification_preferences,
      notifications,
      notification_templates
    RESTART IDENTITY CASCADE
  `);
  await resetModule4Tables();
}

/** Inserts one committed source event used only to anchor a failed delivery fixture. */
async function createSourceEvent(): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into outbox_events
      (event_type, aggregate_type, aggregate_id, payload, status, published_at)
     values ('payment.failed', 'payment', $1, '{}'::jsonb, 'published', now())
     returning id`,
    [randomUUID()],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 18 HTTP source event insert did not return an id.");
  return id;
}

beforeEach(async () => {
  await resetModule18HttpTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 18 Notification HTTP/RBAC integration", () => {
  it("requires authentication and keeps list/read state strictly inside the authenticated user scope", async () => {
    await request(createApp()).get("/api/v1/notifications").expect(401).expect((response) => {
      expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
    });

    const owner = await registerCustomer(`module18-owner-${randomUUID()}@example.com`);
    const other = await registerCustomer(`module18-other-${randomUUID()}@example.com`);
    const ownerToken = await loginUser(owner);
    const repository = new NotificationsRepository();
    const owned = await repository.createNotification({
      userId: owner.id,
      type: "order.created",
      title: "Order placed",
      body: "Your order was placed.",
    });
    const foreign = await repository.createNotification({
      userId: other.id,
      type: "order.created",
      title: "Private order",
      body: "Private to another customer.",
    });

    const list = await request(createApp())
      .get("/api/v1/notifications")
      .set(bearer(ownerToken))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(owned.id);
    expect(list.body.meta.unreadCount).toBe(1);

    await request(createApp())
      .post(`/api/v1/notifications/${foreign.id}/read`)
      .set(bearer(ownerToken))
      .send({})
      .expect(404)
      .expect((response) => {
        expect(response.body.error.code).toBe(NOTIFICATIONS_ERROR_CODE.NOT_FOUND);
      });

    await request(createApp())
      .post(`/api/v1/notifications/${owned.id}/read`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
  });

  it("updates own preferences while keeping privileged delivery failure/retry routes admin-only", async () => {
    const customer = await registerCustomer(`module18-customer-${randomUUID()}@example.com`);
    const admin = await createPlatformAdmin();
    const customerToken = await loginUser(customer);
    const adminToken = await loginUser(admin);

    const preferenceBody = {
      preferences: [
        { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.EMAIL, enabled: false },
        { eventCode: "order.created", channel: NOTIFICATION_CHANNEL.IN_APP, enabled: true },
      ],
    };
    await request(createApp())
      .put("/api/v1/notifications/preferences")
      .set(bearer(customerToken))
      .send(preferenceBody)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual(preferenceBody.preferences);
      });

    const sourceEventId = await createSourceEvent();
    const repository = new NotificationsRepository();
    const failed = await repository.createDeliveryIfMissing({
      sourceEventId,
      userId: customer.id,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      templateCode: "payment.failed.email",
      destinationMasked: "m***@example.com",
      status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      attempts: 5,
      lastErrorCode: "EMAIL_PROVIDER_REQUEST_FAILED",
    });
    if (!failed) throw new Error("Module 18 failed delivery fixture was not inserted.");

    await request(createApp())
      .get("/api/v1/admin/notification-deliveries")
      .set(bearer(customerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
      });

    const adminList = await request(createApp())
      .get("/api/v1/admin/notification-deliveries")
      .set(bearer(adminToken))
      .expect(200);
    expect(adminList.body.data).toEqual([
      expect.objectContaining({
        id: failed.id,
        destinationMasked: "m***@example.com",
        status: NOTIFICATION_DELIVERY_STATUS.FAILED,
      }),
    ]);

    await request(createApp())
      .post(`/api/v1/admin/notification-deliveries/${failed.id}/retry`)
      .set(bearer(adminToken))
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe(NOTIFICATION_DELIVERY_STATUS.QUEUED);
      });
  });
});
