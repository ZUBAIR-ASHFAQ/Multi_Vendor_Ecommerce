import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OutboxEventRow } from "../../src/database/schema/foundation.js";
import { INVENTORY_OUTBOX_EVENT } from "../../src/modules/inventory/inventory.constants.js";
import { ORDERS_OUTBOX_EVENT } from "../../src/modules/orders/orders.constants.js";
import { PAYMENTS_OUTBOX_EVENT } from "../../src/modules/payments/payments.constants.js";
import { RETURNS_OUTBOX_EVENT } from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import { SELLER_OUTBOX_EVENT } from "../../src/modules/sellers/sellers.constants.js";
import { SHIPPING_OUTBOX_EVENT } from "../../src/modules/shipping/shipping.constants.js";
import { WALLET_PAYOUT_OUTBOX_EVENT } from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { NOTIFICATION_CHANNEL } from "../../src/modules/notifications/notifications.constants.js";
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DefaultNotificationDispatchPolicy,
} from "../../src/modules/notifications/notifications.policy.js";

/** Builds one committed outbox row without requiring database setup for pure notification-policy tests. */
function sourceEvent(
  eventType: string,
  payload: Record<string, unknown>,
): OutboxEventRow {
  const now = new Date("2026-09-16T10:00:00.000Z");
  return {
    id: randomUUID(),
    eventType,
    aggregateType: "test",
    aggregateId: randomUUID(),
    payload,
    headers: null,
    status: "published",
    attempts: 1,
    availableAt: now,
    publishedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns user/channel identities in stable order so policy assertions stay compact and readable. */
function targetKeys(
  targets: readonly { userId: string; channel: string }[],
): string[] {
  return targets
    .map((target) => `${target.userId}:${target.channel}`)
    .sort();
}

describe("Module 18 default Notification dispatch policy", () => {
  it("uses the committed order.created payload for the customer without requiring cross-module lookups", async () => {
    const customerUserId = randomUUID();
    const orderId = randomUUID();
    const policy = new DefaultNotificationDispatchPolicy();

    const targets = await policy.resolveTargets(
      sourceEvent(ORDERS_OUTBOX_EVENT.CREATED, {
        orderId,
        orderNo: "ORD-M18-1001",
        customerUserId,
      }),
    );

    expect(targetKeys(targets)).toEqual(
      [
        `${customerUserId}:${NOTIFICATION_CHANNEL.IN_APP}`,
        `${customerUserId}:${NOTIFICATION_CHANNEL.EMAIL}`,
      ].sort(),
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: customerUserId,
          templateCode: `${ORDERS_OUTBOX_EVENT.CREATED}.${NOTIFICATION_CHANNEL.EMAIL}`,
          variables: { orderNo: "ORD-M18-1001" },
          data: { orderId },
        }),
      ]),
    );
  });

  it("notifies sellers on payment-confirmed/cancelled Orders but keeps payment, shipping, and return outcomes customer-facing", async () => {
    const customerUserId = randomUUID();
    const sellerId = randomUUID();
    const sellerOwnerUserId = randomUUID();
    const orderId = randomUUID();
    const policy = new DefaultNotificationDispatchPolicy({
      orders: {
        /** Returns one stable customer and seller participant set for every event in this focused policy test. */
        async resolveNotificationParticipants() {
          return { customerUserId, sellerIds: [sellerId] };
        },
      },
      sellers: {
        /** Resolves the only seller in this focused policy test to its owner identity. */
        async resolveNotificationOwnerUserId() {
          return sellerOwnerUserId;
        },
      },
    });

    for (const eventType of [
      ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED,
      ORDERS_OUTBOX_EVENT.CANCELLED,
    ]) {
      const targets = await policy.resolveTargets(sourceEvent(eventType, { orderId }));
      expect(targetKeys(targets)).toEqual(
        [
          `${customerUserId}:${NOTIFICATION_CHANNEL.IN_APP}`,
          `${customerUserId}:${NOTIFICATION_CHANNEL.EMAIL}`,
          `${sellerOwnerUserId}:${NOTIFICATION_CHANNEL.IN_APP}`,
          `${sellerOwnerUserId}:${NOTIFICATION_CHANNEL.EMAIL}`,
        ].sort(),
      );
    }

    for (const eventType of [
      PAYMENTS_OUTBOX_EVENT.FAILED,
      SHIPPING_OUTBOX_EVENT.SHIPPED,
      SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED,
      SHIPPING_OUTBOX_EVENT.DELIVERED,
      RETURNS_OUTBOX_EVENT.APPROVED,
      RETURNS_OUTBOX_EVENT.REJECTED,
      RETURNS_OUTBOX_EVENT.RECEIVED,
      RETURNS_OUTBOX_EVENT.REFUND_COMPLETED,
    ]) {
      const targets = await policy.resolveTargets(
        sourceEvent(eventType, {
          orderId,
          shipmentId: randomUUID(),
          returnRequestId: randomUUID(),
          refundId: randomUUID(),
        }),
      );
      expect(targetKeys(targets)).toEqual(
        [
          `${customerUserId}:${NOTIFICATION_CHANNEL.IN_APP}`,
          `${customerUserId}:${NOTIFICATION_CHANNEL.EMAIL}`,
        ].sort(),
      );
    }
  });

  it("routes seller operational and finance events only to the persisted seller owner", async () => {
    const sellerId = randomUUID();
    const sellerOwnerUserId = randomUUID();
    const resolveNotificationOwnerUserId = vi.fn().mockResolvedValue(sellerOwnerUserId);
    const policy = new DefaultNotificationDispatchPolicy({
      sellers: { resolveNotificationOwnerUserId },
    });

    for (const eventType of [
      SELLER_OUTBOX_EVENT.SELLER_SUSPENDED,
      INVENTORY_OUTBOX_EVENT.LOW_STOCK,
      RETURNS_OUTBOX_EVENT.REQUESTED,
      WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED,
    ]) {
      const targets = await policy.resolveTargets(
        sourceEvent(eventType, {
          sellerId,
          inventoryItemId: randomUUID(),
          returnRequestId: randomUUID(),
          walletEntryId: randomUUID(),
          payoutId: randomUUID(),
        }),
      );
      expect(targetKeys(targets)).toEqual(
        [
          `${sellerOwnerUserId}:${NOTIFICATION_CHANNEL.IN_APP}`,
          `${sellerOwnerUserId}:${NOTIFICATION_CHANNEL.EMAIL}`,
        ].sort(),
      );
      expect(targets[0]?.data).toEqual(expect.objectContaining({ sellerId }));
    }

    expect(resolveNotificationOwnerUserId).toHaveBeenCalledTimes(7);
  });

  it("keeps direct seller-application recipients independent of cross-module lookups and fails closed on malformed events", async () => {
    const approvedOwner = randomUUID();
    const rejectedApplicant = randomUUID();
    const policy = new DefaultNotificationDispatchPolicy();

    const approved = await policy.resolveTargets(
      sourceEvent(SELLER_OUTBOX_EVENT.SELLER_APPROVED, {
        sellerId: randomUUID(),
        ownerUserId: approvedOwner,
      }),
    );
    const rejected = await policy.resolveTargets(
      sourceEvent(SELLER_OUTBOX_EVENT.SELLER_REJECTED, {
        applicationId: randomUUID(),
        applicantUserId: rejectedApplicant,
      }),
    );

    expect(approved.map((target) => target.userId)).toEqual([approvedOwner, approvedOwner]);
    expect(rejected.map((target) => target.userId)).toEqual([
      rejectedApplicant,
      rejectedApplicant,
    ]);
    await expect(
      policy.resolveTargets(sourceEvent(ORDERS_OUTBOX_EVENT.CREATED, { orderId: randomUUID() })),
    ).resolves.toEqual([]);
    await expect(policy.resolveTargets(sourceEvent("unknown.event", {}))).resolves.toEqual([]);
  });

  it("bootstraps exactly one in-app and one email template for every built-in source event", () => {
    const codes = DEFAULT_NOTIFICATION_TEMPLATES.map((template) => template.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const eventType of [
      ORDERS_OUTBOX_EVENT.CREATED,
      ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED,
      ORDERS_OUTBOX_EVENT.CANCELLED,
      SELLER_OUTBOX_EVENT.SELLER_APPROVED,
      SELLER_OUTBOX_EVENT.SELLER_REJECTED,
      SELLER_OUTBOX_EVENT.SELLER_SUSPENDED,
      INVENTORY_OUTBOX_EVENT.LOW_STOCK,
      PAYMENTS_OUTBOX_EVENT.FAILED,
      SHIPPING_OUTBOX_EVENT.SHIPPED,
      SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED,
      SHIPPING_OUTBOX_EVENT.DELIVERED,
      RETURNS_OUTBOX_EVENT.REQUESTED,
      RETURNS_OUTBOX_EVENT.APPROVED,
      RETURNS_OUTBOX_EVENT.REJECTED,
      RETURNS_OUTBOX_EVENT.RECEIVED,
      RETURNS_OUTBOX_EVENT.REFUND_COMPLETED,
      WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID,
      WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED,
    ]) {
      expect(codes).toContain(`${eventType}.${NOTIFICATION_CHANNEL.IN_APP}`);
      expect(codes).toContain(`${eventType}.${NOTIFICATION_CHANNEL.EMAIL}`);
    }
  });
});
