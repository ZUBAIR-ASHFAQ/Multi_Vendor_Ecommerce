import type { OutboxEventRow } from "../../database/schema/foundation.js";
import { INVENTORY_OUTBOX_EVENT } from "../inventory/inventory.constants.js";
import { ORDERS_OUTBOX_EVENT } from "../orders/orders.constants.js";
import { PAYMENTS_OUTBOX_EVENT } from "../payments/payments.constants.js";
import { RETURNS_OUTBOX_EVENT } from "../returns-refunds/returns-refunds.constants.js";
import { REPORTS_OUTBOX_EVENT } from "../reports/reports.constants.js";
import { SELLER_OUTBOX_EVENT } from "../sellers/sellers.constants.js";
import { SHIPPING_OUTBOX_EVENT } from "../shipping/shipping.constants.js";
import { WALLET_PAYOUT_OUTBOX_EVENT } from "../seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { NOTIFICATION_CHANNEL } from "./notifications.constants.js";
import type {
  NotificationDispatchPolicy,
  NotificationDispatchTarget,
} from "./notifications.service.js";
import type { NotificationChannel } from "./notifications.schema.js";

/** One bootstrapped template required by a built-in notification event mapping. */
export interface DefaultNotificationTemplateDefinition {
  code: string;
  channel: NotificationChannel;
  subjectTemplate: string;
  bodyTemplate: string;
  version: number;
}

/** Narrow Orders boundary used only to resolve immutable notification participants. */
export interface NotificationOrdersDirectory {
  /** Returns the customer and seller identities attached to one committed Order. */
  resolveNotificationParticipants(
    orderId: string,
  ): Promise<{ customerUserId: string; sellerIds: string[] } | null>;
}

/** Narrow Seller boundary used only to resolve the stable owner recipient for seller-scoped alerts. */
export interface NotificationSellerDirectory {
  /** Returns the seller owner user id without exposing seller persistence to Notifications. */
  resolveNotificationOwnerUserId(sellerId: string): Promise<string | null>;
}

/** Optional service boundaries used by the default event-to-recipient policy. */
export interface DefaultNotificationDispatchPolicyDependencies {
  orders?: NotificationOrdersDirectory;
  sellers?: NotificationSellerDirectory;
}

/** Builds matching in-app and email templates for one source event. */
function templatePair(
  eventType: string,
  subjectTemplate: string,
  bodyTemplate: string,
): DefaultNotificationTemplateDefinition[] {
  return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL].map((channel) => ({
    code: `${eventType}.${channel}`,
    channel,
    subjectTemplate,
    bodyTemplate,
    version: 1,
  }));
}

/** Built-in templates for the transactional events required through Module 18. */
export const DEFAULT_NOTIFICATION_TEMPLATES: readonly DefaultNotificationTemplateDefinition[] = [
  ...templatePair(
    ORDERS_OUTBOX_EVENT.CREATED,
    "Order placed",
    "Your order {{orderNo}} was placed.",
  ),
  ...templatePair(
    ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED,
    "Order payment confirmed",
    "Payment was confirmed for this order.",
  ),
  ...templatePair(
    ORDERS_OUTBOX_EVENT.CANCELLED,
    "Order cancelled",
    "This order was cancelled.",
  ),
  ...templatePair(
    SELLER_OUTBOX_EVENT.SELLER_APPROVED,
    "Seller application approved",
    "Your seller application was approved.",
  ),
  ...templatePair(
    SELLER_OUTBOX_EVENT.SELLER_REJECTED,
    "Seller application update",
    "Your seller application was not approved.",
  ),
  ...templatePair(
    SELLER_OUTBOX_EVENT.SELLER_SUSPENDED,
    "Seller account suspended",
    "Your seller account was suspended.",
  ),
  ...templatePair(
    INVENTORY_OUTBOX_EVENT.LOW_STOCK,
    "Low stock alert",
    "One of your inventory variants reached its low-stock threshold.",
  ),
  ...templatePair(
    PAYMENTS_OUTBOX_EVENT.FAILED,
    "Payment failed",
    "Your payment attempt failed. You can retry before the payment deadline when allowed.",
  ),
  ...templatePair(
    SHIPPING_OUTBOX_EVENT.SHIPPED,
    "Order shipped",
    "A shipment for your order is on the way.",
  ),
  ...templatePair(
    SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED,
    "Tracking updated",
    "Tracking information for your order was updated.",
  ),
  ...templatePair(
    SHIPPING_OUTBOX_EVENT.DELIVERED,
    "Order delivered",
    "A shipment for your order was delivered.",
  ),
  ...templatePair(
    RETURNS_OUTBOX_EVENT.REQUESTED,
    "New return request",
    "A customer submitted a return request for your seller order.",
  ),
  ...templatePair(
    RETURNS_OUTBOX_EVENT.APPROVED,
    "Return approved",
    "Your return request was approved.",
  ),
  ...templatePair(
    RETURNS_OUTBOX_EVENT.REJECTED,
    "Return rejected",
    "Your return request was rejected.",
  ),
  ...templatePair(
    RETURNS_OUTBOX_EVENT.RECEIVED,
    "Return received",
    "Your returned item was received for inspection.",
  ),
  ...templatePair(
    RETURNS_OUTBOX_EVENT.REFUND_COMPLETED,
    "Refund completed",
    "Your refund was completed.",
  ),
  ...templatePair(
    WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE,
    "Seller funds available",
    "Seller earnings became available for payout.",
  ),
  ...templatePair(
    WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED,
    "Payout requested",
    "Your payout request was recorded.",
  ),
  ...templatePair(
    WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID,
    "Payout paid",
    "Your payout was completed.",
  ),
  ...templatePair(
    WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED,
    "Payout failed",
    "Your payout failed and the reserved balance was released according to policy.",
  ),
  ...templatePair(
    REPORTS_OUTBOX_EVENT.GENERATED,
    "Report export ready",
    "Your requested report export is ready to download.",
  ),
  ...templatePair(
    REPORTS_OUTBOX_EVENT.FAILED,
    "Report export failed",
    "Your requested report export could not be generated.",
  ),
];

/** Returns a plain object payload without trusting arrays, null, or primitive event payloads. */
function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

/** Returns one non-empty string payload field or null when the source event does not provide it. */
function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Builds the two supported channel targets for one known recipient user id. */
function directRecipientTargets(input: {
  userId: string;
  eventType: string;
  variables?: Record<string, string>;
  allowedVariables?: readonly string[];
  data: Record<string, unknown>;
}): NotificationDispatchTarget[] {
  return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL].map((channel) => ({
    userId: input.userId,
    channel,
    templateCode: `${input.eventType}.${channel}`,
    notificationType: input.eventType,
    variables: input.variables ?? {},
    allowedVariables: input.allowedVariables ?? [],
    data: input.data,
  }));
}

/** Removes duplicate user/channel targets before the service applies its stricter persistence identity check. */
function uniqueTargets(targets: readonly NotificationDispatchTarget[]): NotificationDispatchTarget[] {
  const seen = new Set<string>();
  const unique: NotificationDispatchTarget[] = [];

  for (const target of targets) {
    const key = `${target.userId}:${target.channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }

  return unique;
}

/**
 * Built-in Module 18 policy for source events required by the current marketplace modules.
 * Cross-module recipient lookups use narrow service boundaries and never import another module's repository.
 */
export class DefaultNotificationDispatchPolicy implements NotificationDispatchPolicy {
  private readonly orders: NotificationOrdersDirectory | null;
  private readonly sellers: NotificationSellerDirectory | null;

  /** Stores only the narrow participant resolvers needed by transactional notification policy. */
  constructor(dependencies: DefaultNotificationDispatchPolicyDependencies = {}) {
    this.orders = dependencies.orders ?? null;
    this.sellers = dependencies.sellers ?? null;
  }

  /** Resolves one committed source event into customer and/or seller-owner delivery targets. */
  async resolveTargets(sourceEvent: OutboxEventRow): Promise<readonly NotificationDispatchTarget[]> {
    const payload = payloadRecord(sourceEvent.payload);

    if (sourceEvent.eventType === ORDERS_OUTBOX_EVENT.CREATED) {
      const userId = payloadString(payload, "customerUserId");
      const orderId = payloadString(payload, "orderId");
      const orderNo = payloadString(payload, "orderNo");
      if (!userId || !orderId || !orderNo) return [];

      return directRecipientTargets({
        userId,
        eventType: sourceEvent.eventType,
        variables: { orderNo },
        allowedVariables: ["orderNo"],
        data: { orderId },
      });
    }

    if (sourceEvent.eventType === SELLER_OUTBOX_EVENT.SELLER_APPROVED) {
      const userId = payloadString(payload, "ownerUserId");
      const sellerId = payloadString(payload, "sellerId");
      if (!userId || !sellerId) return [];

      return directRecipientTargets({
        userId,
        eventType: sourceEvent.eventType,
        data: { sellerId },
      });
    }

    if (sourceEvent.eventType === SELLER_OUTBOX_EVENT.SELLER_REJECTED) {
      const userId = payloadString(payload, "applicantUserId");
      const applicationId = payloadString(payload, "applicationId");
      if (!userId || !applicationId) return [];

      return directRecipientTargets({
        userId,
        eventType: sourceEvent.eventType,
        data: { applicationId },
      });
    }

    if (
      sourceEvent.eventType === REPORTS_OUTBOX_EVENT.GENERATED
      || sourceEvent.eventType === REPORTS_OUTBOX_EVENT.FAILED
    ) {
      const userId = payloadString(payload, "recipientUserId");
      const reportRunId = payloadString(payload, "reportRunId");
      if (!userId || !reportRunId) return [];
      return directRecipientTargets({
        userId,
        eventType: sourceEvent.eventType,
        data: this.eventData(payload, { reportRunId }),
      });
    }

    if (
      sourceEvent.eventType === ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED
      || sourceEvent.eventType === ORDERS_OUTBOX_EVENT.CANCELLED
      || sourceEvent.eventType === PAYMENTS_OUTBOX_EVENT.FAILED
      || sourceEvent.eventType === SHIPPING_OUTBOX_EVENT.SHIPPED
      || sourceEvent.eventType === SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED
      || sourceEvent.eventType === SHIPPING_OUTBOX_EVENT.DELIVERED
      || sourceEvent.eventType === RETURNS_OUTBOX_EVENT.APPROVED
      || sourceEvent.eventType === RETURNS_OUTBOX_EVENT.REJECTED
      || sourceEvent.eventType === RETURNS_OUTBOX_EVENT.RECEIVED
      || sourceEvent.eventType === RETURNS_OUTBOX_EVENT.REFUND_COMPLETED
    ) {
      return this.resolveOrderEventTargets(sourceEvent.eventType, payload);
    }

    if (
      sourceEvent.eventType === SELLER_OUTBOX_EVENT.SELLER_SUSPENDED
      || sourceEvent.eventType === INVENTORY_OUTBOX_EVENT.LOW_STOCK
      || sourceEvent.eventType === RETURNS_OUTBOX_EVENT.REQUESTED
      || sourceEvent.eventType === WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE
      || sourceEvent.eventType === WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED
      || sourceEvent.eventType === WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID
      || sourceEvent.eventType === WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED
    ) {
      return this.resolveSellerEventTargets(sourceEvent.eventType, payload);
    }

    return [];
  }

  /** No built-in event/channel pair is made mandatory without an explicit source-policy requirement. */
  isMandatory(_eventCode: string, _channel: NotificationChannel): boolean {
    return false;
  }

  /** Resolves a customer recipient from immutable Order ownership and seller owners for seller-facing Order events. */
  private async resolveOrderEventTargets(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<NotificationDispatchTarget[]> {
    const orderId = payloadString(payload, "orderId");
    if (!orderId || !this.orders) return [];

    const participants = await this.orders.resolveNotificationParticipants(orderId);
    if (!participants) return [];

    const targets = directRecipientTargets({
      userId: participants.customerUserId,
      eventType,
      data: this.eventData(payload, { orderId }),
    });

    if (
      eventType === ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED
      || eventType === ORDERS_OUTBOX_EVENT.CANCELLED
    ) {
      for (const sellerId of participants.sellerIds) {
        const ownerUserId = await this.resolveSellerOwnerUserId(sellerId);
        if (!ownerUserId) continue;
        targets.push(
          ...directRecipientTargets({
            userId: ownerUserId,
            eventType,
            data: { orderId, sellerId },
          }),
        );
      }
    }

    return uniqueTargets(targets);
  }

  /** Resolves the stable seller owner for one seller-scoped operational or finance event. */
  private async resolveSellerEventTargets(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<NotificationDispatchTarget[]> {
    const sellerId = payloadString(payload, "sellerId");
    if (!sellerId) return [];

    const ownerUserId = await this.resolveSellerOwnerUserId(sellerId);
    if (!ownerUserId) return [];

    return directRecipientTargets({
      userId: ownerUserId,
      eventType,
      data: this.eventData(payload, { sellerId }),
    });
  }

  /** Resolves one seller owner through the injected Seller service boundary. */
  private async resolveSellerOwnerUserId(sellerId: string): Promise<string | null> {
    return this.sellers?.resolveNotificationOwnerUserId(sellerId) ?? null;
  }

  /** Keeps only stable identifiers/status values that are useful to the in-app client. */
  private eventData(
    payload: Record<string, unknown>,
    required: Record<string, string>,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = { ...required };

    for (const key of [
      "shipmentId",
      "returnRequestId",
      "refundId",
      "payoutId",
      "walletEntryId",
      "inventoryItemId",
      "status",
      "trackingNo",
      "reportCode",
      "fileId",
      "errorCode",
    ]) {
      const value = payload[key];
      if (typeof value === "string" || typeof value === "number") {
        data[key] = value;
      }
    }

    return data;
  }
}
