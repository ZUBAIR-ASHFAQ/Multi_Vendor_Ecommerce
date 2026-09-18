import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  RETURN_REQUEST_STATUS,
  RETURNS_AUDIT_ACTION,
  RETURNS_ERROR_CODE,
  RETURNS_OUTBOX_EVENT,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import { ReturnsRefundsService } from "../../src/modules/returns-refunds/returns-refunds.service.js";
import {
  countCommissionRefundEntries,
  countReturnAuditEvents,
  countReturnOutboxEvents,
  countReturnRestockMovements,
  countReturnStatusHistory,
  countSucceededPaymentRefunds,
  createIntegrationReturnsService,
  issueReturnRefund,
  prepareDeliveredReturnFixture,
  readBusinessRefund,
  readCommissionEntries,
  readOnHandQuantity,
  readPaymentRefundTotals,
  readReturnState,
  resetModule14Tables,
  customerReturnContext,
  sellerReturnContext,
} from "./module14.test-helpers.js";

beforeEach(async () => {
  await resetModule14Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Returns one stable AppError from a rejected operation for business-code assertions. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Module 14 operation to reject.");
}

/** Creates, approves, and optionally receives one Return through the real Module 14 service/database boundary. */
async function prepareReturn(
  service: ReturnsRefundsService,
  fixture: Awaited<ReturnType<typeof prepareDeliveredReturnFixture>>,
  input: { quantity: number; receive?: boolean; resolution?: "refund_restock" | "refund_no_restock" },
) {
  const customerContext = customerReturnContext(fixture.customerUserId);
  const sellerContext = sellerReturnContext({
    actorId: fixture.sellerUserId,
    sellerId: fixture.sellerId,
    storeId: fixture.storeId,
  });
  const created = await service.createReturnRequest(customerContext, fixture.orderId, {
    sellerOrderId: fixture.sellerOrderId,
    reasonCode: "damaged",
    items: [{ orderItemId: fixture.orderItemId, quantity: input.quantity }],
  });
  const approved = await service.approveReturn(sellerContext, created.id, {
    note: "Approved by Module 14 integration test",
  });
  if (!input.receive) return approved;

  return service.receiveReturn(sellerContext, created.id, {
    items: [
      {
        returnItemId: created.items[0]!.id,
        itemCondition: "opened",
        resolution: input.resolution ?? "refund_restock",
      },
    ],
    note: "Physical Return inspected",
  });
}

/** Converts one exact NUMERIC(20,4) string to scale-4 integer units without floating-point arithmetic. */
function scale4Units(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const units = BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
  return negative ? -units : units;
}

describe("Module 14 PostgreSQL/payment/inventory/commission regression", () => {
  it("runs delivered Return -> receive -> provider refund -> Commission reversal -> restock -> close exactly once", async () => {
    const fixture = await prepareDeliveredReturnFixture(2);
    const { service, provider } = createIntegrationReturnsService();
    const received = await prepareReturn(service, fixture, {
      quantity: 1,
      receive: true,
      resolution: "refund_restock",
    });
    expect(received.status).toBe(RETURN_REQUEST_STATUS.RECEIVED);
    expect(received.history?.map((entry) => entry.toStatus)).toEqual([
      RETURN_REQUEST_STATUS.REQUESTED,
      RETURN_REQUEST_STATUS.APPROVED,
      RETURN_REQUEST_STATUS.RECEIVED,
    ]);
    const returnItemId = received.items[0]!.id;
    const onHandBeforeRefund = await readOnHandQuantity(fixture.variantId);
    const key = `module14-integration-refund-${randomUUID()}`;

    const first = await issueReturnRefund(service, fixture, received.id, key);
    const replay = await issueReturnRefund(service, fixture, received.id, key);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      returnRequestId: received.id,
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      amount: "100.0000",
      currency: "PKR",
      providerRef: expect.any(String),
    });
    expect(provider.createRefundCalls).toHaveLength(1);
    expect(await countSucceededPaymentRefunds(fixture.paymentId)).toBe(1);
    expect(await countReturnRestockMovements(returnItemId)).toBe(1);
    expect(await readOnHandQuantity(fixture.variantId)).toBe(onHandBeforeRefund + 1);
    expect(await countCommissionRefundEntries(fixture.orderItemId)).toBe(1);
    expect(await countReturnStatusHistory(received.id, RETURN_REQUEST_STATUS.CLOSED)).toBe(1);

    const state = await readReturnState(received.id);
    expect(state.request?.status).toBe(RETURN_REQUEST_STATUS.CLOSED);
    expect(state.items).toEqual([
      expect.objectContaining({
        id: returnItemId,
        resolution: "refund_restock",
        refund_amount: "100.0000",
        restock_qty: 1,
      }),
    ]);
    expect(await readBusinessRefund(received.id)).toMatchObject({
      amount: "100.0000",
      currency: "PKR",
      status: "completed",
      idempotency_key: key,
      provider_ref: first.providerRef,
    });
    expect(await readPaymentRefundTotals(fixture.paymentId)).toMatchObject({
      status: "partially_refunded",
      amount_refunded: "100.0000",
    });

    const commissionEntries = await readCommissionEntries(fixture.orderItemId);
    expect(commissionEntries).toHaveLength(2);
    expect(commissionEntries[0]).toMatchObject({
      type: "sale",
      gross_amount: "200.0000",
      commission_amount: "20.0000",
      seller_net_amount: "180.0000",
    });
    expect(commissionEntries[1]).toMatchObject({
      type: "refund",
      gross_amount: "-100.0000",
      commission_amount: "-10.0000",
      seller_net_amount: "-90.0000",
    });

    const refund = await readBusinessRefund(received.id);
    if (!refund) throw new Error("Expected persisted business Refund.");
    expect(await countReturnAuditEvents(RETURNS_AUDIT_ACTION.REFUND_COMPLETED, refund.id)).toBe(1);
    expect(await countReturnAuditEvents(RETURNS_AUDIT_ACTION.CLOSED, received.id)).toBe(1);
    expect(await countReturnOutboxEvents(RETURNS_OUTBOX_EVENT.REFUND_COMPLETED, refund.id)).toBe(1);
    expect(await countReturnOutboxEvents(RETURNS_OUTBOX_EVENT.CLOSED, received.id)).toBe(1);
  });

  it("supports approved refund-without-restock while keeping physical stock unchanged", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const { service } = createIntegrationReturnsService();
    const approved = await prepareReturn(service, fixture, { quantity: 1, receive: false });
    const onHandBeforeRefund = await readOnHandQuantity(fixture.variantId);

    const result = await issueReturnRefund(
      service,
      fixture,
      approved.id,
      `module14-no-restock-${randomUUID()}`,
    );

    expect(result.amount).toBe("100.0000");
    const state = await readReturnState(approved.id);
    expect(state.request?.status).toBe(RETURN_REQUEST_STATUS.CLOSED);
    expect(state.items[0]).toMatchObject({
      resolution: "refund_no_restock",
      restock_qty: 0,
      refund_amount: "100.0000",
    });
    expect(await countReturnRestockMovements(state.items[0]!.id)).toBe(0);
    expect(await readOnHandQuantity(fixture.variantId)).toBe(onHandBeforeRefund);
    expect(await countCommissionRefundEntries(fixture.orderItemId)).toBe(1);
  });

  it("recovers from a provider failure with the same business key without duplicating successful financial effects", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const integration = createIntegrationReturnsService();
    const approved = await prepareReturn(integration.service, fixture, {
      quantity: 1,
      receive: false,
    });
    const key = `module14-provider-retry-${randomUUID()}`;
    integration.provider.failNextRefund = true;

    await expect(
      issueReturnRefund(integration.service, fixture, approved.id, key),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect((await readReturnState(approved.id)).request?.status).toBe(
      RETURN_REQUEST_STATUS.APPROVED,
    );
    expect(await countSucceededPaymentRefunds(fixture.paymentId)).toBe(0);

    const completed = await issueReturnRefund(integration.service, fixture, approved.id, key);

    expect(completed.amount).toBe("100.0000");
    expect(integration.provider.createRefundCalls).toHaveLength(2);
    expect(await countSucceededPaymentRefunds(fixture.paymentId)).toBe(1);
    expect(await countCommissionRefundEntries(fixture.orderItemId)).toBe(1);
    expect(await countReturnStatusHistory(approved.id, RETURN_REQUEST_STATUS.CLOSED)).toBe(1);
  });

  it("serializes concurrent Return allocation so two requests cannot over-claim the same delivered quantity", async () => {
    const fixture = await prepareDeliveredReturnFixture(2);
    const firstService = new ReturnsRefundsService();
    const secondService = new ReturnsRefundsService();
    const context = customerReturnContext(fixture.customerUserId);
    const input = {
      sellerOrderId: fixture.sellerOrderId,
      reasonCode: "damaged" as const,
      items: [{ orderItemId: fixture.orderItemId, quantity: 2 }],
    };

    const results = await Promise.allSettled([
      firstService.createReturnRequest({ ...context, requestId: randomUUID() }, fixture.orderId, input),
      secondService.createReturnRequest({ ...context, requestId: randomUUID() }, fixture.orderId, input),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = await rejectedAppError(Promise.reject((rejected[0] as PromiseRejectedResult).reason));
    expect(error.code).toBe(RETURNS_ERROR_CODE.NOT_ELIGIBLE);
  });

  it("uses cumulative immutable item economics so separate partial Returns reconcile exactly to the original line total", async () => {
    const fixture = await prepareDeliveredReturnFixture(3);
    const { service } = createIntegrationReturnsService();

    const first = await prepareReturn(service, fixture, { quantity: 1, receive: false });
    const firstRefund = await issueReturnRefund(
      service,
      fixture,
      first.id,
      `module14-cumulative-first-${randomUUID()}`,
    );
    expect(firstRefund.amount).toBe("100.0000");

    const second = await prepareReturn(service, fixture, { quantity: 2, receive: false });
    const secondRefund = await issueReturnRefund(
      service,
      fixture,
      second.id,
      `module14-cumulative-second-${randomUUID()}`,
    );
    expect(secondRefund.amount).toBe("200.0000");

    expect(await readPaymentRefundTotals(fixture.paymentId)).toMatchObject({
      amount_refunded: "300.0000",
    });
    expect(await countSucceededPaymentRefunds(fixture.paymentId)).toBe(2);
    expect(await countCommissionRefundEntries(fixture.orderItemId)).toBe(2);
    const entries = await readCommissionEntries(fixture.orderItemId);
    const grossTotal = entries.reduce(
      (total, entry) => total + scale4Units(entry.gross_amount),
      0n,
    );
    expect(grossTotal).toBe(0n);
  });
});
