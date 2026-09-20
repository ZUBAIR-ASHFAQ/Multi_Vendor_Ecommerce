import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { databasePool } from "../../src/database/db.js";
import type { PaymentProviderAdapter, CreateProviderPaymentIntentInput, ProviderPaymentIntent, CancelProviderPaymentIntentInput, VerifiedProviderWebhookEvent, CreateProviderRefundInput, ProviderRefund } from "../../src/integrations/payments/payment-provider.contract.js";
import { CommissionsService } from "../../src/modules/commissions/commissions.service.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import {
  RETURNS_PERMISSION,
  RETURN_ITEM_RESOLUTION,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import type {
  ReturnRefundResult,
  ReturnRequestResponse,
} from "../../src/modules/returns-refunds/returns-refunds.schema.js";
import { ReturnsRefundsService } from "../../src/modules/returns-refunds/returns-refunds.service.js";
import {
  getCustomerOrderViaHttp,
} from "../module11/module11.test-helpers.js";
import {
  createPaymentsJobSpy,
} from "../module12/module12.test-helpers.js";
import {
  createShipmentViaHttp,
  markShipmentDeliveredViaHttp,
  markShipmentShippedViaHttp,
  updateShipmentTrackingViaHttp,
  bearer,
  createProductSellerFixture,
  registerCustomer,
  loginUser,
} from "../module13/module13.test-helpers.js";
import {
  adminCommissionContext,
  prepareCapturedCommissionFixture,
  resetModule16Tables,
  systemCommissionContext,
} from "../module16/module16.test-helpers.js";

/** Real delivered/captured fixture reused by Module 14 repository, HTTP, and integration proof. */
export interface DeliveredReturnFixture {
  captured: Awaited<ReturnType<typeof prepareCapturedCommissionFixture>>;
  orderId: string;
  sellerOrderId: string;
  orderItemId: string;
  sellerId: string;
  storeId: string;
  sellerUserId: string;
  sellerToken: string;
  customerUserId: string;
  customerToken: string;
  variantId: string;
  shipmentId: string;
  paymentId: string;
}

/** Clears Module 14 rows before restoring every released prerequisite fixture table and RBAC seed. */
export async function resetModule14Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      dispute_notes,
      return_status_history,
      refunds,
      return_items,
      return_requests
    RESTART IDENTITY CASCADE
  `);
  await resetModule16Tables();
  // Module 16 does not own Shipping configuration rows, so clear Module 13 persistence explicitly.
  await databasePool.query(`
    TRUNCATE TABLE
      shipment_status_history,
      shipment_items,
      shipments,
      shipping_methods
    RESTART IDENTITY CASCADE
  `);
}

/** Builds one customer context with the exact own-Return permissions used by Module 14 services. */
export function customerReturnContext(
  actorId: string,
  permissions: PermissionCode[] = [RETURNS_PERMISSION.CREATE_OWN, RETURNS_PERMISSION.READ_OWN],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one seller context whose Return permission is effective only inside the supplied seller/store scope. */
export function sellerReturnContext(input: {
  actorId: string;
  sellerId: string;
  storeId: string;
  permissions?: PermissionCode[];
}): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: input.actorId,
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([input.sellerId]),
    storeIds: new Set([input.storeId]),
    sellerPermissions: new Map([
      [input.sellerId, new Set(input.permissions ?? [RETURNS_PERMISSION.SELLER_MANAGE])],
    ]),
    sessionId: randomUUID(),
  };
}

/** Builds one privileged Return/refund context while allowing a persisted user ID for status-history foreign keys. */
export function adminReturnContext(
  actorId: string,
  permissions: PermissionCode[] = [
    RETURNS_PERMISSION.ADMIN_MANAGE,
    RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE,
  ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates one captured Order, accepts it, ships every item, delivers it, and settles its original Commission sale. */
export async function prepareDeliveredReturnFixture(
  quantity = 2,
): Promise<DeliveredReturnFixture> {
  const captured = await prepareCapturedCommissionFixture({
    sellerCount: 1,
    quantities: [quantity],
    prices: ["100.00"],
    shippingRates: ["10.0000"],
  });
  const order = await getCustomerOrderViaHttp(captured.order.customerToken, captured.order.orderId);
  const sellerOrder = order.sellerOrders[0];
  const orderItem = sellerOrder?.items[0];
  const sellerFixture = captured.order.sellers[0]?.product.seller;
  const variantId = captured.order.sellers[0]?.product.variant.id;
  if (!sellerOrder || !orderItem || !sellerFixture || !variantId) {
    throw new Error("Module 14 delivered fixture could not resolve its Seller Order item.");
  }

  await request(createApp())
    .post(`/api/v1/seller/orders/${sellerOrder.id}/accept`)
    .set(bearer(sellerFixture.ownerToken))
    .send({})
    .expect(200);

  const shipment = await createShipmentViaHttp(
    sellerFixture.ownerToken,
    sellerOrder.id,
    [{ orderItemId: orderItem.id, quantity }],
    `module14-shipment-create-${randomUUID()}`,
  );
  await updateShipmentTrackingViaHttp(sellerFixture.ownerToken, shipment.id, {
    carrier: "Module 14 Carrier",
    trackingNo: `RET-${randomUUID()}`,
    serviceLevel: "Standard",
  });
  await markShipmentShippedViaHttp(
    sellerFixture.ownerToken,
    shipment.id,
    `module14-shipment-ship-${randomUUID()}`,
  );
  await markShipmentDeliveredViaHttp(
    sellerFixture.ownerToken,
    shipment.id,
    `module14-shipment-deliver-${randomUUID()}`,
  );

  const commissions = new CommissionsService();
  await commissions.createRule(adminCommissionContext(), {
    priority: 10,
    scopeType: "default",
    scopeId: null,
    ratePercent: "10.000000",
    fixedFee: null,
    fundingRulesJson: null,
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: null,
    status: "active",
  });
  await commissions.settleOrder(systemCommissionContext(), {
    sourceKey: `module14-commission-settle-${captured.order.orderId}`,
    orderId: captured.order.orderId,
  });

  return {
    captured,
    orderId: captured.order.orderId,
    sellerOrderId: sellerOrder.id,
    orderItemId: orderItem.id,
    sellerId: sellerFixture.sellerId,
    storeId: sellerFixture.storeId,
    sellerUserId: sellerFixture.owner.id,
    sellerToken: sellerFixture.ownerToken,
    customerUserId: captured.order.customer.id,
    customerToken: captured.order.customerToken,
    variantId,
    shipmentId: shipment.id,
    paymentId: captured.paymentId,
  };
}

/** Provider test double that accepts existing persisted PaymentIntent IDs and succeeds refunds without network access. */
export class ReturnRefundProvider implements PaymentProviderAdapter {
  readonly createRefundCalls: CreateProviderRefundInput[] = [];
  readonly refunds = new Map<string, ProviderRefund>();
  readonly refundByIdempotencyKey = new Map<string, string>();
  failNextRefund = false;

  /** Module 14 does not create PaymentIntents through this provider double. */
  async createPaymentIntent(_input: CreateProviderPaymentIntentInput): Promise<ProviderPaymentIntent> {
    throw new Error("Module 14 refund provider does not create PaymentIntents.");
  }

  /** Module 14 does not retrieve PaymentIntents through this provider double. */
  async retrievePaymentIntent(_providerPaymentId: string): Promise<ProviderPaymentIntent> {
    throw new Error("Module 14 refund provider does not retrieve PaymentIntents.");
  }

  /** Module 14 does not cancel PaymentIntents through this provider double. */
  async cancelPaymentIntent(_input: CancelProviderPaymentIntentInput): Promise<ProviderPaymentIntent> {
    throw new Error("Module 14 refund provider does not cancel PaymentIntents.");
  }

  /** Module 14 does not process provider webhooks through this refund-only provider double. */
  async verifyAndParseWebhook(_rawBody: Buffer, _signature: string): Promise<VerifiedProviderWebhookEvent> {
    throw new Error("Module 14 refund provider does not parse webhooks.");
  }

  /** Creates one deterministic succeeded Refund or injects one provider failure for retry proof. */
  async createRefund(input: CreateProviderRefundInput): Promise<ProviderRefund> {
    this.createRefundCalls.push(input);
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new Error("Injected Module 14 provider refund failure.");
    }
    const existingId = this.refundByIdempotencyKey.get(input.providerIdempotencyKey);
    if (existingId) {
      const existing = this.refunds.get(existingId);
      if (!existing) throw new Error("Module 14 provider refund replay state is inconsistent.");
      if (
        existing.providerPaymentId !== input.providerPaymentId ||
        existing.amountMinor !== input.amountMinor
      ) {
        throw new Error("Module 14 provider idempotency key was reused with different economics.");
      }
      return { ...existing };
    }

    const providerRefundId = `re_module14_${randomUUID().replaceAll("-", "")}`;
    const refund: ProviderRefund = {
      providerRefundId,
      providerPaymentId: input.providerPaymentId,
      amountMinor: input.amountMinor,
      currency: "PKR",
      status: "succeeded",
      createdAt: new Date(),
    };
    this.refunds.set(providerRefundId, refund);
    this.refundByIdempotencyKey.set(input.providerIdempotencyKey, providerRefundId);
    return { ...refund };
  }

  /** Replays one previously created provider Refund by immutable provider identity. */
  async retrieveRefund(providerRefundId: string): Promise<ProviderRefund> {
    const refund = this.refunds.get(providerRefundId);
    if (!refund) throw new Error("Module 14 provider refund was not found.");
    return { ...refund };
  }
}

/** Creates the real Returns service around PostgreSQL while replacing only live provider/BullMQ Payment dependencies. */
export function createIntegrationReturnsService(provider = new ReturnRefundProvider()): {
  service: ReturnsRefundsService;
  provider: ReturnRefundProvider;
} {
  const jobs = createPaymentsJobSpy();
  const payments = new PaymentsService({
    provider,
    jobs: jobs.jobs,
    currencyExponents: { PKR: 2, USD: 2 },
  });
  return {
    service: new ReturnsRefundsService({ payments }),
    provider,
  };
}

/** Creates one customer Return through the published HTTP route. */
export async function createReturnViaHttp(
  customerToken: string,
  orderId: string,
  input: { sellerOrderId: string; reasonCode?: string; items: Array<{ orderItemId: string; quantity: number }> },
): Promise<ReturnRequestResponse> {
  const response = await request(createApp())
    .post(`/api/v1/orders/${orderId}/returns`)
    .set(bearer(customerToken))
    .send({
      sellerOrderId: input.sellerOrderId,
      reasonCode: input.reasonCode ?? "damaged",
      items: input.items,
    })
    .expect(201);
  return response.body.data as ReturnRequestResponse;
}

/** Approves one seller-scoped Return through the published HTTP route. */
export async function approveReturnViaHttp(
  sellerToken: string,
  returnRequestId: string,
  note = "Approved by Module 14 test",
): Promise<ReturnRequestResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/returns/${returnRequestId}/approve`)
    .set(bearer(sellerToken))
    .send({ note })
    .expect(200);
  return response.body.data as ReturnRequestResponse;
}

/** Receives and resolves every Return Item through the published seller HTTP route. */
export async function receiveReturnViaHttp(
  sellerToken: string,
  returnRequestId: string,
  items: Array<{ returnItemId: string; itemCondition: string; resolution: string }>,
): Promise<ReturnRequestResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/returns/${returnRequestId}/receive`)
    .set(bearer(sellerToken))
    .send({ items, note: "Module 14 inspection complete" })
    .expect(200);
  return response.body.data as ReturnRequestResponse;
}

/** Calls the admin refund service directly so provider proof stays deterministic and never reaches live Stripe. */
export async function issueReturnRefund(
  service: ReturnsRefundsService,
  fixture: DeliveredReturnFixture,
  returnRequestId: string,
  idempotencyKey: string,
): Promise<ReturnRefundResult> {
  return service.issueRefund(
    adminReturnContext(fixture.customerUserId, [RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE]),
    returnRequestId,
    { note: "Module 14 provider refund" },
    idempotencyKey,
  );
}

/** Creates a second fully approved seller identity for seller A/B isolation checks. */
export async function createSecondSeller(adminToken: string) {
  return createProductSellerFixture(adminToken, `Module14OtherSeller${randomUUID()}`);
}

/** Creates a second customer identity for customer A/B isolation checks. */
export async function createSecondCustomer() {
  const customer = await registerCustomer(`module14-other-customer-${randomUUID()}@example.com`);
  return { customer, token: await loginUser(customer) };
}

/** Reads one Return Request and its current item economics directly for reconciliation assertions. */
export async function readReturnState(returnRequestId: string) {
  const requestResult = await databasePool.query<{
    id: string;
    status: string;
    order_id: string;
    seller_order_id: string;
    customer_user_id: string;
  }>(
    `select id, status, order_id, seller_order_id, customer_user_id
       from return_requests
      where id = $1`,
    [returnRequestId],
  );
  const itemsResult = await databasePool.query<{
    id: string;
    order_item_id: string;
    quantity: number;
    resolution: string | null;
    refund_amount: string;
    restock_qty: number;
  }>(
    `select id, order_item_id, quantity, resolution, refund_amount::text, restock_qty
       from return_items
      where return_request_id = $1
      order by id`,
    [returnRequestId],
  );
  return { request: requestResult.rows[0] ?? null, items: itemsResult.rows };
}

/** Reads one Module 14 business Refund row by Return Request. */
export async function readBusinessRefund(returnRequestId: string) {
  const result = await databasePool.query<{
    id: string;
    amount: string;
    currency: string;
    status: string;
    provider_ref: string | null;
    idempotency_key: string;
  }>(
    `select id, amount::text, currency, status, provider_ref, idempotency_key
       from refunds
      where return_request_id = $1`,
    [returnRequestId],
  );
  return result.rows[0] ?? null;
}

/** Reads Payment captured/refunded totals after provider-authoritative Return refund execution. */
export async function readPaymentRefundTotals(paymentId: string) {
  const result = await databasePool.query<{
    status: string;
    amount_captured: string;
    amount_refunded: string;
  }>(
    `select status, amount_captured::text, amount_refunded::text
       from payments
      where id = $1`,
    [paymentId],
  );
  return result.rows[0] ?? null;
}

/** Counts succeeded Payment refund transactions for exactly-once provider assertions. */
export async function countSucceededPaymentRefunds(paymentId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from payment_transactions
      where payment_id = $1 and type = 'refund' and status = 'succeeded'`,
    [paymentId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Return-origin Inventory restock movements for one Return Item. */
export async function countReturnRestockMovements(returnItemId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from stock_movements
      where source_type = 'return'
        and source_id = $1
        and movement_type = 'restock'`,
    [returnItemId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts immutable Commission refund rows tied to one Order Item. */
export async function countCommissionRefundEntries(orderItemId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from commission_entries
      where order_item_id = $1 and type = 'refund'`,
    [orderItemId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads the original sale and appended refund Commission components for economic reconciliation. */
export async function readCommissionEntries(orderItemId: string) {
  const result = await databasePool.query<{
    type: string;
    gross_amount: string;
    commission_amount: string;
    seller_net_amount: string;
  }>(
    `select type, gross_amount::text, commission_amount::text, seller_net_amount::text
       from commission_entries
      where order_item_id = $1
      order by created_at, id`,
    [orderItemId],
  );
  return result.rows;
}

/** Counts append-only Return lifecycle transitions to prove terminal commands do not duplicate history. */
export async function countReturnStatusHistory(
  returnRequestId: string,
  toStatus: string,
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from return_status_history
      where return_request_id = $1 and to_status = $2`,
    [returnRequestId, toStatus],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 14 audit evidence for one action/resource identity. */
export async function countReturnAuditEvents(action: string, resourceId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from audit_logs
      where action = $1 and resource_id = $2`,
    [action, resourceId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 14 outbox evidence for one event/aggregate identity. */
export async function countReturnOutboxEvents(eventType: string, aggregateId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from outbox_events
      where event_type = $1 and aggregate_id = $2`,
    [eventType, aggregateId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads Inventory on-hand quantity so restock remains independent from refund money. */
export async function readOnHandQuantity(variantId: string): Promise<number> {
  const result = await databasePool.query<{ on_hand_qty: number }>(
    `select on_hand_qty from inventory_items where variant_id = $1`,
    [variantId],
  );
  return result.rows[0]?.on_hand_qty ?? 0;
}

/** Convenience value used by receipt tests to express the physical-restock resolution. */
export const RESTOCK_RESOLUTION = RETURN_ITEM_RESOLUTION.REFUND_RESTOCK;
