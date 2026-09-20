import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type {
  RefundRow,
  ReturnItemRow,
  ReturnRequestRow,
} from "../../src/database/schema/returns-refunds.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import {
  RETURN_ITEM_RESOLUTION,
  RETURN_REQUEST_STATUS,
  RETURNS_ERROR_CODE,
  RETURNS_PERMISSION,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import { ReturnsRefundsRepository } from "../../src/modules/returns-refunds/returns-refunds.repository.js";
import {
  ReturnsRefundsService,
  type ReturnsAdministrationIntegration,
  type ReturnsAuditIntegration,
  type ReturnsCommissionsIntegration,
  type ReturnsIdempotencyIntegration,
  type ReturnsInventoryIntegration,
  type ReturnsOrdersIntegration,
  type ReturnsOutboxIntegration,
  type ReturnsPaymentsIntegration,
  type ReturnsShippingIntegration,
} from "../../src/modules/returns-refunds/returns-refunds.service.js";

const NOW = new Date("2026-09-15T06:00:00.000Z");

/** Builds one customer context with the exact own-Return permissions required by the service. */
function customerContext(actorId = randomUUID()): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set([RETURNS_PERMISSION.CREATE_OWN, RETURNS_PERMISSION.READ_OWN]),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one seller context with one seller/store scope and the Module 14 manage permission. */
function sellerContext(input: {
  actorId?: string;
  sellerId?: string;
  storeId?: string;
  includePermission?: boolean;
} = {}): RequestContext {
  const sellerId = input.sellerId ?? randomUUID();
  const storeId = input.storeId ?? randomUUID();
  return {
    requestId: randomUUID(),
    actorId: input.actorId ?? randomUUID(),
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([sellerId]),
    storeIds: new Set([storeId]),
    sellerPermissions: new Map([
      [
        sellerId,
        new Set(input.includePermission === false ? [] : [RETURNS_PERMISSION.SELLER_MANAGE]),
      ],
    ]),
    sessionId: randomUUID(),
  };
}

/** Builds one platform-admin context with the provider-refund permission. */
function refundAdminContext(actorId = randomUUID()): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set([RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE]),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one immutable trusted Order snapshot for service orchestration tests. */
function orderSnapshot(input: {
  customerUserId?: string;
  orderId?: string;
  sellerOrderId?: string;
  sellerId?: string;
  storeId?: string;
  orderItemId?: string;
  variantId?: string;
  quantity?: number;
  lineTotal?: string;
} = {}) {
  const orderId = input.orderId ?? randomUUID();
  const sellerOrderId = input.sellerOrderId ?? randomUUID();
  const sellerId = input.sellerId ?? randomUUID();
  const storeId = input.storeId ?? randomUUID();
  const orderItemId = input.orderItemId ?? randomUUID();
  return {
    orderId,
    customerUserId: input.customerUserId ?? randomUUID(),
    currency: "PKR",
    paymentStatus: "captured",
    orderStatus: "confirmed",
    items: [
      {
        orderItemId,
        sellerOrderId,
        sellerId,
        storeId,
        variantId: input.variantId ?? randomUUID(),
        quantity: input.quantity ?? 2,
        cancelledQuantity: 0,
        unitPrice: "100.0000",
        discountAllocated: "0.0000",
        taxAllocated: "0.0000",
        lineTotal: input.lineTotal ?? "200.0000",
      },
    ],
  } as const;
}

/** Builds one persisted Return Request row for lifecycle tests. */
function returnRequestRow(
  status: string,
  input: Partial<ReturnRequestRow> = {},
): ReturnRequestRow {
  const requestedAt = input.requestedAt ?? new Date("2026-09-15T05:00:00.000Z");
  return {
    id: input.id ?? randomUUID(),
    returnNo: input.returnNo ?? `RET-${randomUUID().replaceAll("-", "").toUpperCase()}`,
    orderId: input.orderId ?? randomUUID(),
    sellerOrderId: input.sellerOrderId ?? randomUUID(),
    customerUserId: input.customerUserId ?? randomUUID(),
    status,
    reasonCode: input.reasonCode ?? "damaged",
    requestedAt,
    approvedAt:
      input.approvedAt ??
      (status === RETURN_REQUEST_STATUS.REQUESTED || status === RETURN_REQUEST_STATUS.REJECTED
        ? null
        : new Date(requestedAt.getTime() + 60_000)),
  };
}

/** Builds one persisted Return Item row with explicit inspection/refund defaults. */
function returnItemRow(input: Partial<ReturnItemRow> = {}): ReturnItemRow {
  return {
    id: input.id ?? randomUUID(),
    returnRequestId: input.returnRequestId ?? randomUUID(),
    orderItemId: input.orderItemId ?? randomUUID(),
    quantity: input.quantity ?? 1,
    itemCondition: input.itemCondition ?? null,
    resolution: input.resolution ?? null,
    refundAmount: input.refundAmount ?? "0.0000",
    restockQty: input.restockQty ?? 0,
  };
}

/** Runs service transactions immediately while keeping tests independent from PostgreSQL. */
function immediateTransactionRunner<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return work({} as DatabaseTransaction);
}

/** Creates no-op immutable evidence boundaries used by focused service tests. */
function evidenceBoundaries() {
  const audit: ReturnsAuditIntegration = {
    record: vi.fn().mockResolvedValue(randomUUID()),
  };
  const outbox: ReturnsOutboxIntegration = {
    enqueue: vi.fn().mockResolvedValue(randomUUID()),
  };
  return { audit, outbox };
}

describe("Module 14 Return eligibility and seller lifecycle service", () => {
  it("creates one requested Return only from delivered remaining quantity and appends immutable evidence", async () => {
    const customerUserId = randomUUID();
    const order = orderSnapshot({ customerUserId });
    const orderItem = order.items[0]!;
    const created = returnRequestRow(RETURN_REQUEST_STATUS.REQUESTED, {
      orderId: order.orderId,
      sellerOrderId: orderItem.sellerOrderId,
      customerUserId,
      requestedAt: NOW,
    });
    const createdItem = returnItemRow({
      returnRequestId: created.id,
      orderItemId: orderItem.orderItemId,
      quantity: 1,
    });
    const repository = {
      lockReturnAllocations: vi.fn().mockResolvedValue(undefined),
      sumNonRejectedReturnQuantities: vi.fn().mockResolvedValue([]),
      createReturnRequest: vi.fn().mockResolvedValue(created),
      createReturnItems: vi.fn().mockResolvedValue([createdItem]),
      appendStatusHistory: vi.fn().mockResolvedValue({
        id: randomUUID(),
        returnRequestId: created.id,
        fromStatus: null,
        toStatus: RETURN_REQUEST_STATUS.REQUESTED,
        changedBy: customerUserId,
        reason: null,
        changedAt: NOW,
      }),
    } as unknown as ReturnsRefundsRepository;
    const orders: ReturnsOrdersIntegration = {
      getReturnSnapshot: vi.fn().mockResolvedValue(order),
    };
    const shipping: ReturnsShippingIntegration = {
      getReturnDeliverySnapshot: vi.fn().mockResolvedValue([
        {
          orderItemId: orderItem.orderItemId,
          deliveredQuantity: 2,
          latestDeliveredAt: "2026-09-10T06:00:00.000Z",
        },
      ]),
    };
    const administration: ReturnsAdministrationIntegration = {
      getReturnWindowDays: vi.fn().mockResolvedValue(30),
    };
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => orders,
      shippingUsingTransaction: () => shipping,
      administration,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      now: () => NOW,
      createId: () => created.id,
    });

    const result = await service.createReturnRequest(customerContext(customerUserId), order.orderId, {
      sellerOrderId: orderItem.sellerOrderId,
      reasonCode: "damaged",
      items: [{ orderItemId: orderItem.orderItemId, quantity: 1 }],
    });

    expect(result).toMatchObject({
      id: created.id,
      status: RETURN_REQUEST_STATUS.REQUESTED,
      customerUserId,
      items: [{ orderItemId: orderItem.orderItemId, quantity: 1 }],
    });
    expect(repository.lockReturnAllocations).toHaveBeenCalledWith([orderItem.orderItemId]);
    expect(repository.sumNonRejectedReturnQuantities).toHaveBeenCalledWith([orderItem.orderItemId]);
    expect(repository.appendStatusHistory).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ fromStatus: null, toStatus: RETURN_REQUEST_STATUS.REQUESTED }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("includes append-only lifecycle history in the existing customer Return list response", async () => {
    const customerUserId = randomUUID();
    const row = returnRequestRow(RETURN_REQUEST_STATUS.APPROVED, { customerUserId });
    const item = returnItemRow({ returnRequestId: row.id });
    const requestedAt = new Date("2026-09-15T05:00:00.000Z");
    const approvedAt = new Date("2026-09-15T05:10:00.000Z");
    const history = [
      {
        id: randomUUID(),
        returnRequestId: row.id,
        fromStatus: null,
        toStatus: RETURN_REQUEST_STATUS.REQUESTED,
        changedBy: customerUserId,
        reason: null,
        changedAt: requestedAt,
      },
      {
        id: randomUUID(),
        returnRequestId: row.id,
        fromStatus: RETURN_REQUEST_STATUS.REQUESTED,
        toStatus: RETURN_REQUEST_STATUS.APPROVED,
        changedBy: randomUUID(),
        reason: "Eligible return approved",
        changedAt: approvedAt,
      },
    ];
    const repository = {
      listCustomerReturns: vi.fn().mockResolvedValue({ items: [row], totalItems: 1 }),
      listReturnItems: vi.fn().mockResolvedValue([item]),
      listStatusHistory: vi.fn().mockResolvedValue(history),
    } as unknown as ReturnsRefundsRepository;
    const service = new ReturnsRefundsService({ repository });

    const result = await service.listCustomerReturns(customerContext(customerUserId), {
      page: 1,
      pageSize: 20,
      sort: "requestedAt",
      order: "desc",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.history).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: RETURN_REQUEST_STATUS.REQUESTED,
        changedAt: requestedAt.toISOString(),
      }),
      expect.objectContaining({
        fromStatus: RETURN_REQUEST_STATUS.REQUESTED,
        toStatus: RETURN_REQUEST_STATUS.APPROVED,
        reason: "Eligible return approved",
        changedAt: approvedAt.toISOString(),
      }),
    ]);
    expect(repository.listStatusHistory).toHaveBeenCalledWith(row.id);
  });

  it("denies a customer attempting to create a Return for another customer's Order", async () => {
    const actualCustomer = randomUUID();
    const order = orderSnapshot({ customerUserId: randomUUID() });
    const repository = {
      lockReturnAllocations: vi.fn(),
    } as unknown as ReturnsRefundsRepository;
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({
        getReturnSnapshot: vi.fn().mockResolvedValue(order),
      }),
      shippingUsingTransaction: () => ({
        getReturnDeliverySnapshot: vi.fn().mockResolvedValue([]),
      }),
      administration: { getReturnWindowDays: vi.fn().mockResolvedValue(30) },
      now: () => NOW,
    });

    await expect(
      service.createReturnRequest(customerContext(actualCustomer), order.orderId, {
        sellerOrderId: order.items[0]!.sellerOrderId,
        reasonCode: "damaged",
        items: [{ orderItemId: order.items[0]!.orderItemId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: RETURNS_ERROR_CODE.SCOPE_FORBIDDEN, statusCode: 403 });
    expect(repository.lockReturnAllocations).not.toHaveBeenCalled();
  });

  it("rejects expired delivery windows before reserving Return quantity", async () => {
    const customerUserId = randomUUID();
    const order = orderSnapshot({ customerUserId });
    const repository = {
      lockReturnAllocations: vi.fn().mockResolvedValue(undefined),
      sumNonRejectedReturnQuantities: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnsRefundsRepository;
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({ getReturnSnapshot: vi.fn().mockResolvedValue(order) }),
      shippingUsingTransaction: () => ({
        getReturnDeliverySnapshot: vi.fn().mockResolvedValue([
          {
            orderItemId: order.items[0]!.orderItemId,
            deliveredQuantity: 2,
            latestDeliveredAt: "2026-08-01T00:00:00.000Z",
          },
        ]),
      }),
      administration: { getReturnWindowDays: vi.fn().mockResolvedValue(30) },
      now: () => NOW,
    });

    await expect(
      service.createReturnRequest(customerContext(customerUserId), order.orderId, {
        sellerOrderId: order.items[0]!.sellerOrderId,
        reasonCode: "defective",
        items: [{ orderItemId: order.items[0]!.orderItemId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: RETURNS_ERROR_CODE.WINDOW_EXPIRED, statusCode: 409 });
  });

  it("rejects over-allocation using already reserved non-rejected Return quantities", async () => {
    const customerUserId = randomUUID();
    const order = orderSnapshot({ customerUserId, quantity: 2 });
    const repository = {
      lockReturnAllocations: vi.fn().mockResolvedValue(undefined),
      sumNonRejectedReturnQuantities: vi.fn().mockResolvedValue([
        { orderItemId: order.items[0]!.orderItemId, reservedQuantity: 1 },
      ]),
    } as unknown as ReturnsRefundsRepository;
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({ getReturnSnapshot: vi.fn().mockResolvedValue(order) }),
      shippingUsingTransaction: () => ({
        getReturnDeliverySnapshot: vi.fn().mockResolvedValue([
          {
            orderItemId: order.items[0]!.orderItemId,
            deliveredQuantity: 2,
            latestDeliveredAt: "2026-09-14T00:00:00.000Z",
          },
        ]),
      }),
      administration: { getReturnWindowDays: vi.fn().mockResolvedValue(30) },
      now: () => NOW,
    });

    await expect(
      service.createReturnRequest(customerContext(customerUserId), order.orderId, {
        sellerOrderId: order.items[0]!.sellerOrderId,
        reasonCode: "wrong_item",
        items: [{ orderItemId: order.items[0]!.orderItemId, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: RETURNS_ERROR_CODE.NOT_ELIGIBLE, statusCode: 409 });
  });

  it("fails closed when a seller has no effective seller.returns.manage scope", async () => {
    const repository = {
      listSellerReturns: vi.fn(),
    } as unknown as ReturnsRefundsRepository;
    const service = new ReturnsRefundsService({ repository });

    await expect(
      service.listSellerReturns(sellerContext({ includePermission: false }), {
        page: 1,
        pageSize: 20,
        sort: "requestedAt",
        order: "desc",
      }),
    ).rejects.toMatchObject({ code: RETURNS_ERROR_CODE.SCOPE_FORBIDDEN, statusCode: 403 });
    expect(repository.listSellerReturns).not.toHaveBeenCalled();
  });

  it("approves only requested Returns and preserves seller scope in the repository lock", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const order = orderSnapshot({ sellerId, storeId });
    const current = returnRequestRow(RETURN_REQUEST_STATUS.REQUESTED, {
      orderId: order.orderId,
      sellerOrderId: order.items[0]!.sellerOrderId,
    });
    const item = returnItemRow({ returnRequestId: current.id, orderItemId: order.items[0]!.orderItemId });
    const approved = { ...current, status: RETURN_REQUEST_STATUS.APPROVED, approvedAt: NOW };
    const repository = {
      lockReturnInSellerScope: vi.fn().mockResolvedValue(current),
      updateReturnStatus: vi.fn().mockResolvedValue(approved),
      appendStatusHistory: vi.fn().mockResolvedValue(randomUUID()),
      listReturnItems: vi.fn().mockResolvedValue([item]),
      listStatusHistory: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnsRefundsRepository;
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({ getReturnSnapshot: vi.fn().mockResolvedValue(order) }),
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      now: () => NOW,
    });
    const context = sellerContext({ sellerId, storeId });

    const result = await service.approveReturn(context, current.id, { note: "Looks eligible" });

    expect(result.status).toBe(RETURN_REQUEST_STATUS.APPROVED);
    expect(repository.lockReturnInSellerScope).toHaveBeenCalledWith(current.id, {
      sellerIds: [sellerId],
      storeIds: [storeId],
    });
    expect(repository.updateReturnStatus).toHaveBeenCalledWith(current.id, {
      status: RETURN_REQUEST_STATUS.APPROVED,
      approvedAt: NOW,
    });
  });

  it("requires receive to inspect every Return Item and derives restock quantity from resolution", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const order = orderSnapshot({ sellerId, storeId });
    const current = returnRequestRow(RETURN_REQUEST_STATUS.APPROVED, {
      orderId: order.orderId,
      sellerOrderId: order.items[0]!.sellerOrderId,
    });
    const first = returnItemRow({
      returnRequestId: current.id,
      orderItemId: order.items[0]!.orderItemId,
      quantity: 2,
    });
    const second = returnItemRow({
      returnRequestId: current.id,
      orderItemId: randomUUID(),
      quantity: 1,
    });
    const mutableItems = [first, second];
    const repository = {
      lockReturnInSellerScope: vi.fn().mockResolvedValue(current),
      lockReturnItems: vi.fn().mockResolvedValue(mutableItems),
      updateReturnItemResolution: vi.fn().mockImplementation(async (_requestId, itemId, update) => {
        const index = mutableItems.findIndex((item) => item.id === itemId);
        if (index < 0) return null;
        mutableItems[index] = { ...mutableItems[index]!, ...update };
        return mutableItems[index];
      }),
      updateReturnStatus: vi.fn().mockResolvedValue({ ...current, status: RETURN_REQUEST_STATUS.RECEIVED }),
      appendStatusHistory: vi.fn().mockResolvedValue(randomUUID()),
      listReturnItems: vi.fn().mockImplementation(async () => mutableItems),
      listStatusHistory: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnsRefundsRepository;
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({ getReturnSnapshot: vi.fn().mockResolvedValue(order) }),
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      now: () => NOW,
    });
    const context = sellerContext({ sellerId, storeId });

    await expect(
      service.receiveReturn(context, current.id, {
        items: [
          { returnItemId: first.id, itemCondition: "opened", resolution: "refund_restock" },
        ],
      }),
    ).rejects.toMatchObject({ code: RETURNS_ERROR_CODE.STATUS_INVALID, statusCode: 409 });

    const result = await service.receiveReturn(context, current.id, {
      items: [
        { returnItemId: first.id, itemCondition: "opened", resolution: "refund_restock" },
        { returnItemId: second.id, itemCondition: "damaged", resolution: "refund_no_restock" },
      ],
      note: "Inspection complete",
    });

    expect(result.status).toBe(RETURN_REQUEST_STATUS.RECEIVED);
    expect(repository.updateReturnItemResolution).toHaveBeenCalledWith(current.id, first.id, {
      itemCondition: "opened",
      resolution: RETURN_ITEM_RESOLUTION.REFUND_RESTOCK,
      restockQty: 2,
    });
    expect(repository.updateReturnItemResolution).toHaveBeenCalledWith(current.id, second.id, {
      itemCondition: "damaged",
      resolution: RETURN_ITEM_RESOLUTION.REFUND_NO_RESTOCK,
      restockQty: 0,
    });
  });
});

describe("Module 14 provider refund orchestration service", () => {
  /** Creates one stateful refund harness that exercises exact allocation and downstream boundaries without PostgreSQL. */
  function refundHarness(options: { status?: "approved" | "received"; commissionFailure?: Error } = {}) {
    const context = refundAdminContext();
    const order = orderSnapshot({ customerUserId: randomUUID(), quantity: 2, lineTotal: "199.9999" });
    let current = returnRequestRow(options.status ?? RETURN_REQUEST_STATUS.RECEIVED, {
      orderId: order.orderId,
      sellerOrderId: order.items[0]!.sellerOrderId,
      customerUserId: order.customerUserId,
    });
    let item = returnItemRow({
      returnRequestId: current.id,
      orderItemId: order.items[0]!.orderItemId,
      quantity: 1,
      itemCondition: options.status === RETURN_REQUEST_STATUS.APPROVED ? null : "opened",
      resolution:
        options.status === RETURN_REQUEST_STATUS.APPROVED
          ? null
          : RETURN_ITEM_RESOLUTION.REFUND_RESTOCK,
      restockQty: options.status === RETURN_REQUEST_STATUS.APPROVED ? 0 : 1,
    });
    let refund: RefundRow | null = null;
    const completedResponse = {
      id: randomUUID(),
      type: "refund" as const,
      providerTxnId: `re_${randomUUID()}`,
      amount: "100.0000",
      status: "succeeded" as const,
      occurredAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const repository = {
      lockReturnById: vi.fn().mockImplementation(async () => current),
      lockReturnItems: vi.fn().mockImplementation(async () => [item]),
      lockReturnAllocations: vi.fn().mockResolvedValue(undefined),
      updateReturnItemResolution: vi.fn().mockImplementation(async (_requestId, _itemId, update) => {
        item = { ...item, ...update };
        return item;
      }),
      listReturnItemFinancialHistory: vi.fn().mockResolvedValue([]),
      listRefundsForReturn: vi.fn().mockImplementation(async () => (refund ? [refund] : [])),
      createRefundIfMissing: vi.fn().mockImplementation(async (input) => {
        refund = {
          id: input.id ?? randomUUID(),
          returnRequestId: input.returnRequestId,
          orderId: input.orderId,
          paymentId: input.paymentId,
          amount: input.amount,
          currency: input.currency,
          status: input.status,
          providerRef: input.providerRef ?? null,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.createdAt ?? NOW,
          updatedAt: input.updatedAt ?? NOW,
        };
        return refund;
      }),
      findRefundByIdempotencyKey: vi.fn().mockImplementation(async () => refund),
      updateReturnItemRefund: vi.fn().mockImplementation(async (_requestId, _itemId, update) => {
        item = { ...item, refundAmount: update.refundAmount };
        return item;
      }),
      updateRefundResult: vi.fn().mockImplementation(async (_refundId, update) => {
        if (!refund) return null;
        refund = { ...refund, ...update };
        return refund;
      }),
      updateReturnStatus: vi.fn().mockImplementation(async (_returnRequestId, update) => {
        current = { ...current, ...update };
        return current;
      }),
      appendStatusHistory: vi.fn().mockResolvedValue(randomUUID()),
    } as unknown as ReturnsRefundsRepository;
    const payments: ReturnsPaymentsIntegration = {
      getReturnRefundSnapshot: vi.fn().mockResolvedValue({
        paymentId: randomUUID(),
        orderId: order.orderId,
        currency: "PKR",
        amountCaptured: "250.0000",
        amountRefunded: "0.0000",
        refundableAmount: "250.0000",
      }),
      refundPayment: vi.fn().mockResolvedValue(completedResponse),
    };
    const commissions: ReturnsCommissionsIntegration = {
      adjustPartialRefund: options.commissionFailure
        ? vi.fn().mockRejectedValue(options.commissionFailure)
        : vi.fn().mockResolvedValue({
            orderId: order.orderId,
            refundPaymentTransactionId: completedResponse.id,
            entryIds: [randomUUID()],
          }),
    };
    const inventory: ReturnsInventoryIntegration = {
      restockStock: vi.fn().mockResolvedValue({ id: randomUUID() }),
    };
    const idempotency: ReturnsIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({ mode: "acquired", recordId: randomUUID() }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const transactionIdempotency: ReturnsIdempotencyIntegration = {
      ...idempotency,
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReturnsRefundsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({ getReturnSnapshot: vi.fn().mockResolvedValue(order) }),
      payments,
      commissions,
      inventory,
      idempotency,
      idempotencyUsingTransaction: () => transactionIdempotency,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      now: () => NOW,
      createId: () => randomUUID(),
    });
    return {
      service,
      context,
      order,
      getCurrent: () => current,
      getItem: () => item,
      getRefund: () => refund,
      repository,
      payments,
      commissions,
      inventory,
      idempotency,
      transactionIdempotency,
    };
  }

  it("allocates exact cumulative scale-4 money, refunds provider once, reverses Commission, restocks, and closes atomically", async () => {
    const harness = refundHarness();
    const key = `module14-refund-${randomUUID()}`;

    const result = await harness.service.issueRefund(
      harness.context,
      harness.getCurrent().id,
      { note: "Approved refund" },
      key,
    );

    // 199.9999 / 2 rounds half-up to 100.0000 for the first unit.
    expect(result.amount).toBe("100.0000");
    expect(harness.payments.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: ACTOR_TYPE.SYSTEM }),
      expect.any(String),
      expect.objectContaining({ amount: "100.0000" }),
    );
    expect(harness.commissions.adjustPartialRefund).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: ACTOR_TYPE.SYSTEM }),
      expect.objectContaining({
        orderId: harness.order.orderId,
        items: [
          expect.objectContaining({
            orderItemId: harness.order.items[0]!.orderItemId,
            currentRefundQuantity: 1,
            cumulativeRefundQuantity: 1,
            currentRefundAmount: "100.0000",
          }),
        ],
      }),
    );
    expect(harness.inventory.restockStock).toHaveBeenCalledTimes(1);
    expect(harness.getCurrent().status).toBe(RETURN_REQUEST_STATUS.CLOSED);
    expect(harness.getRefund()).toMatchObject({ status: "completed", amount: "100.0000" });
    expect(harness.transactionIdempotency.complete).toHaveBeenCalledWith(
      expect.any(String),
      200,
      result,
    );
    expect(harness.idempotency.fail).not.toHaveBeenCalled();
  });

  it("allows an approved no-physical-return refund and never restocks it", async () => {
    const harness = refundHarness({ status: RETURN_REQUEST_STATUS.APPROVED });

    await harness.service.issueRefund(
      harness.context,
      harness.getCurrent().id,
      {},
      `module14-no-restock-${randomUUID()}`,
    );

    expect(harness.getItem()).toMatchObject({
      itemCondition: null,
      resolution: RETURN_ITEM_RESOLUTION.REFUND_NO_RESTOCK,
      restockQty: 0,
    });
    expect(harness.inventory.restockStock).not.toHaveBeenCalled();
  });

  it("replays a completed Foundation idempotency result without calling provider, Commission, or Inventory again", async () => {
    const replay = {
      refundId: randomUUID(),
      returnRequestId: randomUUID(),
      orderId: randomUUID(),
      paymentId: randomUUID(),
      amount: "50.0000",
      currency: "PKR",
      providerRef: `re_${randomUUID()}`,
    };
    const payments: ReturnsPaymentsIntegration = {
      getReturnRefundSnapshot: vi.fn(),
      refundPayment: vi.fn(),
    };
    const commissions: ReturnsCommissionsIntegration = { adjustPartialRefund: vi.fn() };
    const inventory: ReturnsInventoryIntegration = { restockStock: vi.fn() };
    const idempotency: ReturnsIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({
        mode: "replay",
        replay: { statusCode: 200, responseBody: replay },
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const service = new ReturnsRefundsService({ payments, commissions, inventory, idempotency });

    const result = await service.issueRefund(
      refundAdminContext(),
      replay.returnRequestId,
      {},
      `module14-replay-${randomUUID()}`,
    );

    expect(result).toEqual(replay);
    expect(payments.refundPayment).not.toHaveBeenCalled();
    expect(commissions.adjustPartialRefund).not.toHaveBeenCalled();
    expect(inventory.restockStock).not.toHaveBeenCalled();
  });

  it("marks the Foundation key failed when a downstream financial adjustment fails so the exact provider source can be retried safely", async () => {
    const harness = refundHarness({ commissionFailure: new Error("Injected Commission failure") });

    await expect(
      harness.service.issueRefund(
        harness.context,
        harness.getCurrent().id,
        {},
        `module14-retry-${randomUUID()}`,
      ),
    ).rejects.toThrow("Injected Commission failure");

    expect(harness.payments.refundPayment).toHaveBeenCalledTimes(1);
    expect(harness.inventory.restockStock).not.toHaveBeenCalled();
    expect(harness.idempotency.fail).toHaveBeenCalledTimes(1);
    expect(harness.transactionIdempotency.complete).not.toHaveBeenCalled();
    expect(harness.getCurrent().status).toBe(RETURN_REQUEST_STATUS.RECEIVED);
  });

  it("requires an authenticated platform actor with admin.refunds.issue before beginning idempotency", async () => {
    const idempotency: ReturnsIdempotencyIntegration = {
      begin: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const service = new ReturnsRefundsService({ idempotency });
    const context = refundAdminContext();
    context.permissions = new Set();

    await expect(
      service.issueRefund(context, randomUUID(), {}, "valid-key"),
    ).rejects.toMatchObject({ code: ERROR_CODE.FORBIDDEN, statusCode: 403 });
    expect(idempotency.begin).not.toHaveBeenCalled();
  });
});
