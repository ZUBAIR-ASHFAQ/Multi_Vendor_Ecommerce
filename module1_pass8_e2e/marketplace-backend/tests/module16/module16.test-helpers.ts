import { randomUUID } from "node:crypto";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { databasePool } from "../../src/database/db.js";
import {
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENT_TRANSACTION_TYPE,
} from "../../src/modules/payments/payments.constants.js";
import { PaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import { COMMISSIONS_PERMISSION } from "../../src/modules/commissions/commissions.constants.js";
import {
  confirmOrderPaymentViaHttp,
  prepareOrderFixture,
  type PreparedOrderFixture,
} from "../module11/module11.test-helpers.js";
import { resetModule12Tables } from "../module12/module12.test-helpers.js";

/** Builds one platform-admin Commission context without passing through JWT parsing. */
export function adminCommissionContext(
  permissions: PermissionCode[] = [
    COMMISSIONS_PERMISSION.ADMIN_READ,
    COMMISSIONS_PERMISSION.ADMIN_MANAGE,
  ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one seller Commission context whose permission is effective only for the supplied seller. */
export function sellerCommissionContext(
  sellerId: string,
  permissions: PermissionCode[] = [COMMISSIONS_PERMISSION.SELLER_READ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([sellerId]),
    storeIds: new Set(),
    sellerPermissions: new Map([[sellerId, new Set(permissions)]]),
    sessionId: randomUUID(),
  };
}

/** Builds the trusted system identity used by internal Commission settlement/refund commands. */
export function systemCommissionContext(): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Clears Module 16 first so prerequisite reset helpers never collide with Commission foreign keys. */
export async function resetModule16Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      commission_entries,
      commission_rule_snapshots,
      commission_rules
    RESTART IDENTITY CASCADE
  `);
  await resetModule12Tables();
}

/** Captured Order/Payment fixture used by real Module 16 PostgreSQL and HTTP proof. */
export interface CapturedCommissionFixture {
  order: PreparedOrderFixture;
  paymentId: string;
  captureTransactionId: string;
  capturedAt: string;
}

/** Creates one real Checkout Order plus provider-authoritative local Payment capture and confirmed Order state. */
export async function prepareCapturedCommissionFixture(
  options: Parameters<typeof prepareOrderFixture>[0] = {},
): Promise<CapturedCommissionFixture> {
  const order = await prepareOrderFixture(options);
  const repository = new PaymentsRepository();
  const created = await repository.createPayment({
    orderId: order.orderId,
    provider: PAYMENT_PROVIDER.STRIPE,
    currency: order.quote.currency,
    idempotencyKey: "c".repeat(64),
  });
  if (!created) throw new Error("Expected Module 16 Payment fixture to be created.");

  const providerPaymentId = `pi_module16_${randomUUID().replaceAll("-", "")}`;
  const attached = await repository.attachProviderPayment({
    paymentId: created.id,
    providerPaymentId,
    idempotencyKeyHash: "d".repeat(64),
    status: PAYMENT_STATUS.PROCESSING,
  });
  if (!attached) throw new Error("Expected Module 16 provider Payment identity to be attached.");

  const capturedAt = new Date("2026-09-14T10:00:00.000Z");
  const capture = await repository.createTransaction({
    paymentId: created.id,
    type: PAYMENT_TRANSACTION_TYPE.CAPTURE,
    providerTxnId: `ch_module16_${randomUUID().replaceAll("-", "")}`,
    amount: order.quote.grandTotal,
    status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    occurredAt: capturedAt,
    sourceKey: `payments:provider-capture:${providerPaymentId}`,
  });
  const updated = await repository.updatePaymentTotals({
    paymentId: created.id,
    status: PAYMENT_STATUS.CAPTURED,
    amountAuthorized: order.quote.grandTotal,
    amountCaptured: order.quote.grandTotal,
  });
  if (!updated) throw new Error("Expected Module 16 Payment capture totals to be persisted.");

  await confirmOrderPaymentViaHttp(
    order.orderId,
    order.quote.currency,
    order.quote.grandTotal,
    `module16-order-confirm:${capture.id}`,
    {
      paymentId: created.id,
      paymentTransactionId: capture.id,
      capturedAt: capturedAt.toISOString(),
    },
  );

  return {
    order,
    paymentId: created.id,
    captureTransactionId: capture.id,
    capturedAt: capturedAt.toISOString(),
  };
}

/** Appends one succeeded full provider refund and updates Payment totals for Commission reversal proof. */
export async function createFullCommissionRefund(
  fixture: CapturedCommissionFixture,
): Promise<{ refundTransactionId: string; refundedAt: string }> {
  const repository = new PaymentsRepository();
  const refundedAt = new Date("2026-09-14T11:00:00.000Z");
  const refund = await repository.createTransaction({
    paymentId: fixture.paymentId,
    type: PAYMENT_TRANSACTION_TYPE.REFUND,
    providerTxnId: `re_module16_${randomUUID().replaceAll("-", "")}`,
    amount: fixture.order.quote.grandTotal,
    status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    occurredAt: refundedAt,
    sourceKey: `payments:refund:module16:${randomUUID()}`,
  });
  const updated = await repository.updatePaymentTotals({
    paymentId: fixture.paymentId,
    status: PAYMENT_STATUS.REFUNDED,
    amountRefunded: fixture.order.quote.grandTotal,
  });
  if (!updated) throw new Error("Expected Module 16 full refund totals to be persisted.");
  return { refundTransactionId: refund.id, refundedAt: refundedAt.toISOString() };
}

/** Reads immutable Commission ledger rows for one Order in deterministic creation order. */
export async function readCommissionEntriesForOrder(orderId: string) {
  const result = await databasePool.query<{
    id: string;
    seller_id: string;
    seller_order_id: string;
    order_item_id: string;
    type: string;
    gross_amount: string;
    commission_amount: string;
    seller_net_amount: string;
    currency: string;
    source_key: string;
  }>(
    `select entry.id,
            entry.seller_id,
            entry.seller_order_id,
            entry.order_item_id,
            entry.type,
            entry.gross_amount::text,
            entry.commission_amount::text,
            entry.seller_net_amount::text,
            entry.currency,
            entry.source_key
       from commission_entries entry
       join order_items item on item.id = entry.order_item_id
      where item.order_id = $1
      order by entry.created_at asc, entry.id asc`,
    [orderId],
  );
  return result.rows;
}

/** Reads immutable Commission snapshots for one Order so later rule changes cannot hide history rewrites. */
export async function readCommissionSnapshotsForOrder(orderId: string) {
  const result = await databasePool.query<{
    id: string;
    order_item_id: string;
    rule_id: string | null;
    rate_percent: string;
    fixed_fee: string | null;
    basis_json: Record<string, unknown>;
  }>(
    `select snapshot.id,
            snapshot.order_item_id,
            snapshot.rule_id,
            snapshot.rate_percent::text,
            snapshot.fixed_fee::text,
            snapshot.basis_json
       from commission_rule_snapshots snapshot
       join order_items item on item.id = snapshot.order_item_id
      where item.order_id = $1
      order by snapshot.order_item_id asc`,
    [orderId],
  );
  return result.rows;
}

/** Counts durable Commission outbox events for exactly-once settlement/refund assertions. */
export async function countCommissionOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Commission audit actions without exposing event metadata or actor secrets. */
export async function countCommissionAuditEvents(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
