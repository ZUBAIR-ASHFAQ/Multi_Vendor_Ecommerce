import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import type {
  CommissionEntryRow,
  CommissionRuleRow,
  CommissionRuleSnapshotRow,
} from "../../src/database/schema/commissions.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import { ORDER_PAYMENT_STATUS, ORDER_STATUS } from "../../src/modules/orders/orders.constants.js";
import type { OrderCommissionSnapshot } from "../../src/modules/orders/orders.service.js";
import type {
  CommissionPaymentCaptureSnapshot,
  CommissionPaymentRefundSnapshot,
} from "../../src/modules/payments/payments.service.js";
import { PROMOTION_FUNDING_TYPE } from "../../src/modules/promotions/promotions.constants.js";
import {
  COMMISSION_ENTRY_TYPE,
  COMMISSIONS_ERROR_CODE,
  COMMISSIONS_OUTBOX_EVENT,
  COMMISSIONS_PERMISSION,
} from "../../src/modules/commissions/commissions.constants.js";
import {
  CommissionsRepository,
  type CreateCommissionEntryRecordInput,
  type CreateCommissionRuleSnapshotRecordInput,
} from "../../src/modules/commissions/commissions.repository.js";
import {
  CommissionsService,
  type CommissionsAuditIntegration,
  type CommissionsIdempotencyIntegration,
  type CommissionsOutboxIntegration,
} from "../../src/modules/commissions/commissions.service.js";
import {
  adminCommissionContext,
  sellerCommissionContext,
  systemCommissionContext,
} from "./module16.test-helpers.js";

/** Creates one canonical captured Order with a single immutable seller Item. */
function orderSnapshot(overrides: Partial<OrderCommissionSnapshot> = {}): OrderCommissionSnapshot {
  const orderId = randomUUID();
  return {
    orderId,
    currency: "PKR",
    grandTotal: "200.0000",
    paymentStatus: ORDER_PAYMENT_STATUS.CAPTURED,
    orderStatus: ORDER_STATUS.CONFIRMED,
    capturedAt: "2026-09-14T10:00:00.000Z",
    couponCode: null,
    items: [
      {
        orderItemId: randomUUID(),
        sellerOrderId: randomUUID(),
        sellerId: randomUUID(),
        productId: randomUUID(),
        quantity: 2,
        cancelledQuantity: 0,
        unitPrice: "100.0000",
        discountAllocated: "0.0000",
        taxAllocated: "0.0000",
        lineTotal: "200.0000",
      },
    ],
    ...overrides,
  };
}

/** Creates provider-authoritative capture facts matching one immutable Order snapshot. */
function captureSnapshot(
  order: OrderCommissionSnapshot,
  overrides: Partial<CommissionPaymentCaptureSnapshot> = {},
): CommissionPaymentCaptureSnapshot {
  return {
    paymentId: randomUUID(),
    paymentTransactionId: randomUUID(),
    orderId: order.orderId,
    currency: order.currency,
    capturedAmount: order.grandTotal,
    capturedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

/** Creates provider-authoritative full-refund facts matching one captured Order. */
function refundSnapshot(
  order: OrderCommissionSnapshot,
  overrides: Partial<CommissionPaymentRefundSnapshot> = {},
): CommissionPaymentRefundSnapshot {
  return {
    paymentId: randomUUID(),
    paymentTransactionId: randomUUID(),
    orderId: order.orderId,
    currency: order.currency,
    refundAmount: order.grandTotal,
    capturedAmount: order.grandTotal,
    refundedAt: "2026-09-14T11:00:00.000Z",
    ...overrides,
  };
}

/** Creates one persisted Commission rule shape for focused service tests. */
function ruleRow(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
  const now = new Date("2026-09-14T09:00:00.000Z");
  return {
    id: randomUUID(),
    priority: 10,
    scopeType: "default",
    scopeId: null,
    ratePercent: "10.000000",
    fixedFee: "2.0000",
    fundingRulesJson: null,
    startAt: new Date("2026-09-01T00:00:00.000Z"),
    endAt: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Creates one immutable Commission snapshot shape from service-approved persistence input. */
function snapshotRow(
  input: CreateCommissionRuleSnapshotRecordInput,
  overrides: Partial<CommissionRuleSnapshotRow> = {},
): CommissionRuleSnapshotRow {
  return {
    id: randomUUID(),
    orderItemId: input.orderItemId,
    ruleId: input.ruleId ?? null,
    ratePercent: input.ratePercent,
    fixedFee: input.fixedFee ?? null,
    basisJson: input.basisJson,
    createdAt: new Date("2026-09-14T10:00:01.000Z"),
    ...overrides,
  };
}

/** Creates one immutable Commission ledger row from a service-calculated insert. */
function entryRow(
  input: CreateCommissionEntryRecordInput,
  overrides: Partial<CommissionEntryRow> = {},
): CommissionEntryRow {
  return {
    id: randomUUID(),
    sellerId: input.sellerId,
    sellerOrderId: input.sellerOrderId,
    orderItemId: input.orderItemId,
    type: input.type,
    grossAmount: input.grossAmount,
    commissionAmount: input.commissionAmount,
    sellerNetAmount: input.sellerNetAmount,
    currency: input.currency,
    sourceKey: input.sourceKey,
    occurredAt: input.occurredAt,
    createdAt: new Date("2026-09-14T10:00:02.000Z"),
    ...overrides,
  };
}

/** Builds a narrow repository double so each service test overrides only the persistence facts it needs. */
function repositoryStub(
  overrides: Partial<Record<keyof CommissionsRepository, unknown>> = {},
): CommissionsRepository {
  return {
    listAdminRules: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    lockRuleConfiguration: vi.fn().mockResolvedValue(undefined),
    findOverlappingRulesForScope: vi.fn().mockResolvedValue([]),
    createRule: vi.fn().mockImplementation(async (input) => ruleRow(input as Partial<CommissionRuleRow>)),
    findRuleByIdForUpdate: vi.fn().mockResolvedValue(null),
    updateRule: vi.fn().mockResolvedValue(null),
    listEntriesForSeller: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    summarizeEntriesForSeller: vi.fn().mockResolvedValue([]),
    listAdminEntries: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findSnapshotByOrderItemId: vi.fn().mockResolvedValue(null),
    findApplicableRuleCandidates: vi.fn().mockResolvedValue([ruleRow()]),
    createRuleSnapshotIfMissing: vi
      .fn()
      .mockImplementation(async (input: CreateCommissionRuleSnapshotRecordInput) => snapshotRow(input)),
    findEntryBySourceKey: vi.fn().mockResolvedValue(null),
    createEntryIfMissing: vi
      .fn()
      .mockImplementation(async (input: CreateCommissionEntryRecordInput) => entryRow(input)),
    listEntriesByOrderItemId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CommissionsRepository;
}

/** Creates no-database service dependencies while retaining real Commission business logic. */
function serviceHarness(options: {
  order?: OrderCommissionSnapshot;
  capture?: CommissionPaymentCaptureSnapshot;
  refund?: CommissionPaymentRefundSnapshot;
  repository?: CommissionsRepository;
  idempotency?: CommissionsIdempotencyIntegration;
  fundingType?: typeof PROMOTION_FUNDING_TYPE.SELLER | typeof PROMOTION_FUNDING_TYPE.PLATFORM | null;
} = {}) {
  const order = options.order ?? orderSnapshot();
  const capture = options.capture ?? captureSnapshot(order);
  const refund = options.refund ?? refundSnapshot(order);
  const repository = options.repository ?? repositoryStub();
  const idempotency: CommissionsIdempotencyIntegration = options.idempotency ?? {
    begin: vi.fn().mockResolvedValue({ mode: "acquired", recordId: randomUUID() }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const audit: CommissionsAuditIntegration = {
    record: vi.fn().mockResolvedValue(randomUUID()),
  };
  const outbox: CommissionsOutboxIntegration = {
    enqueue: vi.fn().mockResolvedValue(randomUUID()),
  };
  const orders = {
    getCommissionSnapshot: vi.fn().mockResolvedValue(order),
  };
  const payments = {
    getCommissionCapture: vi.fn().mockResolvedValue(capture),
    getCommissionRefund: vi.fn().mockResolvedValue(refund),
  };
  const item = order.items[0];
  if (!item) throw new Error("Service harness requires one Order Item.");
  const products = {
    resolveProductCommissionScope: vi.fn().mockResolvedValue({
      productId: item.productId,
      sellerId: item.sellerId,
      storeId: randomUUID(),
      categoryId: randomUUID(),
    }),
  };
  const promotions = {
    resolveHistoricalCouponFunding: vi.fn().mockResolvedValue(
      options.fundingType === null
        ? null
        : {
            promotionId: randomUUID(),
            fundingType: options.fundingType ?? PROMOTION_FUNDING_TYPE.SELLER,
          },
    ),
  };
  const transaction = {} as DatabaseTransaction;
  const service = new CommissionsService({
    repository,
    repositoryUsingTransaction: () => repository,
    transactionRunner: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
    orders,
    ordersUsingTransaction: () => orders,
    payments,
    products,
    promotions,
    sellers: { assertSellerCommerceEligible: vi.fn().mockResolvedValue(undefined) },
    catalog: { listCategories: vi.fn().mockResolvedValue([]) },
    idempotency,
    audit,
    auditUsingTransaction: () => audit,
    outboxUsingTransaction: () => outbox,
    now: () => new Date("2026-09-14T09:30:00.000Z"),
  });

  return { service, order, capture, refund, repository, idempotency, audit, outbox, orders, payments, products, promotions };
}

/** Returns one AppError from a rejected operation so stable codes stay easy to assert. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Commission service operation to reject.");
}

describe("Module 16 Commissions service", () => {
  it("uses Foundation source-key replay before touching Payment, Order, or Commission persistence", async () => {
    const replay = { orderId: randomUUID(), entryIds: [randomUUID()] };
    const idempotency: CommissionsIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({
        mode: "replay",
        replay: { statusCode: 200, responseBody: replay },
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const harness = serviceHarness({ idempotency });

    const result = await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:replay",
      orderId: replay.orderId,
    });

    expect(result).toEqual(replay);
    expect(harness.payments.getCommissionCapture).not.toHaveBeenCalled();
    expect(harness.orders.getCommissionSnapshot).not.toHaveBeenCalled();
    expect(harness.repository.createEntryIfMissing).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it("propagates Foundation idempotency conflict before Commission business work for source-key reuse with another request", async () => {
    const idempotency: CommissionsIdempotencyIntegration = {
      begin: vi.fn().mockRejectedValue(
        new AppError({
          code: ERROR_CODE.IDEMPOTENCY_CONFLICT,
          message: "Source key belongs to another request.",
          statusCode: 409,
        }),
      ),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const harness = serviceHarness({ idempotency });

    const error = await rejectedAppError(
      harness.service.settleOrder(systemCommissionContext(), {
        sourceKey: "orders:settle:conflict",
        orderId: randomUUID(),
      }),
    );

    expect(error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);
    expect(harness.payments.getCommissionCapture).not.toHaveBeenCalled();
    expect(harness.repository.createEntryIfMissing).not.toHaveBeenCalled();
  });

  it("calculates exact seller-funded discount, percentage fee, fixed fee, seller net, audit, and outbox", async () => {
    const item = orderSnapshot().items[0]!;
    const order = orderSnapshot({
      grandTotal: "180.0000",
      couponCode: "SELLER20",
      items: [{ ...item, discountAllocated: "20.0000" }],
    });
    const rule = ruleRow({ ratePercent: "10.000000", fixedFee: "2.0000" });
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([rule]),
    });
    const harness = serviceHarness({
      order,
      capture: captureSnapshot(order),
      repository,
      fundingType: PROMOTION_FUNDING_TYPE.SELLER,
    });

    const result = await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:seller-funded",
      orderId: order.orderId,
    });

    expect(result.entryIds).toHaveLength(1);
    expect(repository.createRuleSnapshotIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        ratePercent: "10.000000",
        fixedFee: "2.0000",
        basisJson: expect.objectContaining({
          grossAmount: "200.0000",
          sellerFundedDiscountAmount: "20.0000",
          commissionableBasis: "180.0000",
        }),
      }),
    );
    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMISSION_ENTRY_TYPE.SALE,
        grossAmount: "200.0000",
        commissionAmount: "20.0000",
        sellerNetAmount: "160.0000",
      }),
    );
    expect(harness.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: COMMISSIONS_OUTBOX_EVENT.POSTED }),
    );
    expect(harness.audit.record).toHaveBeenCalledTimes(1);
    expect(harness.idempotency.complete).toHaveBeenCalledWith(expect.any(String), 200, result);
  });

  it("creates a zero-fee immutable snapshot when no active Commission rule matches", async () => {
    const order = orderSnapshot();
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([]),
    });
    const harness = serviceHarness({ order, repository });

    await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:no-rule",
      orderId: order.orderId,
    });

    expect(repository.createRuleSnapshotIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: null,
        ratePercent: "0.000000",
        fixedFee: null,
      }),
    );
    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        grossAmount: "200.0000",
        commissionAmount: "0.0000",
        sellerNetAmount: "200.0000",
      }),
    );
  });

  it("rounds percentage Commission half-up to scale 4 without JavaScript floating-point money", async () => {
    const item = orderSnapshot().items[0]!;
    const order = orderSnapshot({
      grandTotal: "0.0001",
      items: [
        {
          ...item,
          quantity: 1,
          unitPrice: "0.0001",
          lineTotal: "0.0001",
        },
      ],
    });
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([
        ruleRow({ ratePercent: "50.000000", fixedFee: null }),
      ]),
    });
    const harness = serviceHarness({ order, capture: captureSnapshot(order), repository });

    await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:half-up-rounding",
      orderId: order.orderId,
    });

    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        grossAmount: "0.0001",
        commissionAmount: "0.0001",
        sellerNetAmount: "0.0000",
      }),
    );
  });

  it("keeps a platform-funded discount out of seller deductions while still charging the snapshotted fee", async () => {
    const item = orderSnapshot().items[0]!;
    const order = orderSnapshot({
      grandTotal: "180.0000",
      couponCode: "PLATFORM20",
      items: [{ ...item, discountAllocated: "20.0000" }],
    });
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([
        ruleRow({ ratePercent: "10.000000", fixedFee: "2.0000" }),
      ]),
    });
    const harness = serviceHarness({
      order,
      capture: captureSnapshot(order),
      repository,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
    });

    await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:platform-funded",
      orderId: order.orderId,
    });

    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        grossAmount: "200.0000",
        commissionAmount: "22.0000",
        sellerNetAmount: "178.0000",
      }),
    );
  });

  it("selects the unique highest numeric priority instead of using hidden scope specificity", async () => {
    const order = orderSnapshot();
    const low = ruleRow({
      id: randomUUID(),
      priority: 10,
      scopeType: "product",
      scopeId: order.items[0]!.productId,
      ratePercent: "50.000000",
      fixedFee: null,
    });
    const high = ruleRow({
      id: randomUUID(),
      priority: 20,
      scopeType: "default",
      scopeId: null,
      ratePercent: "5.000000",
      fixedFee: "1.0000",
    });
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([low, high]),
    });
    const harness = serviceHarness({ order, repository });

    await harness.service.settleOrder(systemCommissionContext(), {
      sourceKey: "orders:settle:priority-winner",
      orderId: order.orderId,
    });

    expect(repository.createRuleSnapshotIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: high.id,
        ratePercent: "5.000000",
        fixedFee: "1.0000",
      }),
    );
    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({ commissionAmount: "11.0000", sellerNetAmount: "189.0000" }),
    );
  });

  it("rejects equal winning priorities instead of silently inventing a Commission tie-break", async () => {
    const order = orderSnapshot();
    const repository = repositoryStub({
      findApplicableRuleCandidates: vi.fn().mockResolvedValue([
        ruleRow({ id: randomUUID(), priority: 20, scopeType: "default" }),
        ruleRow({ id: randomUUID(), priority: 20, scopeType: "seller", scopeId: order.items[0]!.sellerId }),
      ]),
    });
    const harness = serviceHarness({ order, repository });

    const error = await rejectedAppError(
      harness.service.settleOrder(systemCommissionContext(), {
        sourceKey: "orders:settle:ambiguous",
        orderId: order.orderId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.RULE_AMBIGUOUS);
    expect(repository.createEntryIfMissing).not.toHaveBeenCalled();
    expect(harness.idempotency.fail).toHaveBeenCalledTimes(1);
  });

  it("fails closed when provider capture and immutable Order totals do not reconcile", async () => {
    const order = orderSnapshot();
    const harness = serviceHarness({
      order,
      capture: captureSnapshot(order, { capturedAmount: "199.0000" }),
    });

    const error = await rejectedAppError(
      harness.service.settleOrder(systemCommissionContext(), {
        sourceKey: "orders:settle:mismatch",
        orderId: order.orderId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.RULE_INVALID);
    expect(harness.repository.createRuleSnapshotIfMissing).not.toHaveBeenCalled();
    expect(harness.repository.createEntryIfMissing).not.toHaveBeenCalled();
  });

  it("rejects a replay collision when the same authoritative ledger source has different immutable economics", async () => {
    const order = orderSnapshot();
    const capture = captureSnapshot(order);
    const expectedSource = `commission:sale:${capture.paymentTransactionId}:${order.items[0]!.orderItemId}`;
    const repository = repositoryStub({
      findEntryBySourceKey: vi.fn().mockImplementation(async (sourceKey: string) =>
        sourceKey === `commission:sale:${capture.paymentTransactionId}:${order.items[0]!.orderItemId}`
          ? entryRow({
              sellerId: order.items[0]!.sellerId,
              sellerOrderId: order.items[0]!.sellerOrderId,
              orderItemId: order.items[0]!.orderItemId,
              type: COMMISSION_ENTRY_TYPE.SALE,
              grossAmount: "999.0000",
              commissionAmount: "99.0000",
              sellerNetAmount: "900.0000",
              currency: order.currency,
              sourceKey: expectedSource,
              occurredAt: new Date(capture.capturedAt),
            })
          : null,
      ),
    });
    const harness = serviceHarness({ order, capture, repository });

    const error = await rejectedAppError(
      harness.service.settleOrder(systemCommissionContext(), {
        sourceKey: "orders:settle:collision",
        orderId: order.orderId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.SOURCE_DUPLICATE);
    expect(repository.createEntryIfMissing).not.toHaveBeenCalled();
  });

  it("rejects source-key replay when only the provider-authoritative occurredAt timestamp differs", async () => {
    const order = orderSnapshot();
    const capture = captureSnapshot(order);
    const item = order.items[0]!;
    const expectedSource = `commission:sale:${capture.paymentTransactionId}:${item.orderItemId}`;
    const repository = repositoryStub({
      findEntryBySourceKey: vi.fn().mockImplementation(async (sourceKey: string) =>
        sourceKey === expectedSource
          ? entryRow({
              sellerId: item.sellerId,
              sellerOrderId: item.sellerOrderId,
              orderItemId: item.orderItemId,
              type: COMMISSION_ENTRY_TYPE.SALE,
              grossAmount: "200.0000",
              commissionAmount: "22.0000",
              sellerNetAmount: "178.0000",
              currency: order.currency,
              sourceKey: expectedSource,
              occurredAt: new Date("2026-09-14T10:00:01.000Z"),
            })
          : null,
      ),
    });
    const harness = serviceHarness({ order, capture, repository });

    const error = await rejectedAppError(
      harness.service.settleOrder(systemCommissionContext(), {
        sourceKey: "orders:settle:timestamp-collision",
        orderId: order.orderId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.SOURCE_DUPLICATE);
    expect(repository.createEntryIfMissing).not.toHaveBeenCalled();
  });

  it("reverses a full provider refund with append-only negative entries and never edits the original sale", async () => {
    const order = orderSnapshot();
    const item = order.items[0]!;
    const sale = entryRow({
      sellerId: item.sellerId,
      sellerOrderId: item.sellerOrderId,
      orderItemId: item.orderItemId,
      type: COMMISSION_ENTRY_TYPE.SALE,
      grossAmount: "200.0000",
      commissionAmount: "22.0000",
      sellerNetAmount: "178.0000",
      currency: order.currency,
      sourceKey: `commission:sale:${randomUUID()}:${item.orderItemId}`,
      occurredAt: new Date("2026-09-14T10:00:00.000Z"),
    });
    const repository = repositoryStub({
      listEntriesByOrderItemId: vi.fn().mockResolvedValue([sale]),
    });
    const harness = serviceHarness({ order, repository, refund: refundSnapshot(order) });

    const result = await harness.service.adjustRefund(systemCommissionContext(), {
      sourceKey: "refunds:full:1",
      orderId: order.orderId,
      refundPaymentTransactionId: harness.refund.paymentTransactionId,
    });

    expect(result.entryIds).toHaveLength(1);
    expect(repository.createEntryIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMISSION_ENTRY_TYPE.REFUND,
        grossAmount: "-200.0000",
        commissionAmount: "-22.0000",
        sellerNetAmount: "-178.0000",
      }),
    );
    expect(sale).toMatchObject({
      grossAmount: "200.0000",
      commissionAmount: "22.0000",
      sellerNetAmount: "178.0000",
    });
    expect(harness.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: COMMISSIONS_OUTBOX_EVENT.ADJUSTED }),
    );
  });

  it("fails closed for a partial refund until Module 14 supplies item-level allocation", async () => {
    const order = orderSnapshot();
    const partial = refundSnapshot(order, { refundAmount: "50.0000" });
    const harness = serviceHarness({ order, refund: partial });

    const error = await rejectedAppError(
      harness.service.adjustRefund(systemCommissionContext(), {
        sourceKey: "refunds:partial:1",
        orderId: order.orderId,
        refundPaymentTransactionId: partial.paymentTransactionId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.RULE_INVALID);
    expect(harness.repository.createEntryIfMissing).not.toHaveBeenCalled();
    expect(harness.idempotency.fail).toHaveBeenCalledTimes(1);
  });

  it("keeps seller statements inside exactly one seller scope and rejects another actor or ambiguous seller scope", async () => {
    const sellerId = randomUUID();
    const row = entryRow({
      sellerId,
      sellerOrderId: randomUUID(),
      orderItemId: randomUUID(),
      type: COMMISSION_ENTRY_TYPE.SALE,
      grossAmount: "100.0000",
      commissionAmount: "10.0000",
      sellerNetAmount: "90.0000",
      currency: "PKR",
      sourceKey: `commission:sale:${randomUUID()}`,
      occurredAt: new Date("2026-09-14T10:00:00.000Z"),
    });
    const repository = repositoryStub({
      listEntriesForSeller: vi.fn().mockResolvedValue({ items: [row], totalItems: 1 }),
      summarizeEntriesForSeller: vi.fn().mockResolvedValue([
        {
          currency: "PKR",
          grossAmount: "100.0000",
          sellerFundedDiscountAmount: "0.0000",
          commissionAmount: "10.0000",
          refundAdjustmentAmount: "0.0000",
          sellerNetAmount: "90.0000",
        },
      ]),
    });
    const harness = serviceHarness({ repository });

    const result = await harness.service.getSellerStatement(sellerCommissionContext(sellerId), {
      page: 1,
      pageSize: 20,
      sort: "occurredAt",
      order: "desc",
    });
    expect(result.statement.sellerId).toBe(sellerId);
    expect(repository.listEntriesForSeller).toHaveBeenCalledWith(sellerId, expect.any(Object));

    const otherSeller = randomUUID();
    const ambiguous = sellerCommissionContext(sellerId);
    ambiguous.sellerIds = new Set<string>([
      ...ambiguous.sellerIds,
      otherSeller,
    ]);
    ambiguous.sellerPermissions = new Map<
      string,
      ReadonlySet<PermissionCode>
    >([
      ...ambiguous.sellerPermissions,
      [
        otherSeller,
        new Set<PermissionCode>([COMMISSIONS_PERMISSION.SELLER_READ]),
      ],
    ]);
    const ambiguousError = await rejectedAppError(
      harness.service.getSellerStatement(ambiguous, {
        page: 1,
        pageSize: 20,
        sort: "occurredAt",
        order: "desc",
      }),
    );
    expect(ambiguousError.code).toBe(COMMISSIONS_ERROR_CODE.SCOPE_FORBIDDEN);

    const customerError = await rejectedAppError(
      harness.service.getSellerStatement(
        { ...sellerCommissionContext(sellerId), actorType: "customer" },
        { page: 1, pageSize: 20, sort: "occurredAt", order: "desc" },
      ),
    );
    expect(customerError.code).toBe(COMMISSIONS_ERROR_CODE.SCOPE_FORBIDDEN);
  });

  it("enforces admin Commission permissions before rule or finance persistence is read", async () => {
    const repository = repositoryStub();
    const harness = serviceHarness({ repository });
    const noPermissions = adminCommissionContext([]);

    const readError = await rejectedAppError(
      harness.service.listAdminEntries(noPermissions, {
        page: 1,
        pageSize: 20,
        sort: "occurredAt",
        order: "desc",
      }),
    );
    expect(readError.code).toBe(ERROR_CODE.FORBIDDEN);

    const writeError = await rejectedAppError(
      harness.service.createRule(noPermissions, {
        priority: 10,
        scopeType: "default",
        scopeId: null,
        ratePercent: "10.000000",
        fixedFee: null,
        fundingRulesJson: null,
        startAt: "2026-09-15T00:00:00.000Z",
        endAt: null,
        status: "active",
      }),
    );
    expect(writeError.code).toBe(ERROR_CODE.FORBIDDEN);
    expect(repository.listAdminEntries).not.toHaveBeenCalled();
    expect(repository.createRule).not.toHaveBeenCalled();
  });
});
