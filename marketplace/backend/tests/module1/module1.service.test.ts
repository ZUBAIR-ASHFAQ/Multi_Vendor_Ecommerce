import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import {
  DASHBOARD_ERROR_CODE,
  DASHBOARD_PERMISSION,
} from "../../src/modules/dashboard/dashboard.constants.js";
import type { DashboardRepository } from "../../src/modules/dashboard/dashboard.repository.js";
import {
  DashboardService,
  type DashboardReportsReader,
} from "../../src/modules/dashboard/dashboard.service.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SELLER_A = "00000000-0000-4000-8000-000000000002";
const SELLER_B = "00000000-0000-4000-8000-000000000003";
const STORE_A = "00000000-0000-4000-8000-000000000004";
const ORDER_A = "00000000-0000-4000-8000-000000000005";
const SELLER_ORDER_A = "00000000-0000-4000-8000-000000000006";
const SELLER_ORDER_B = "00000000-0000-4000-8000-000000000007";

/** Builds one trusted request context with explicit platform or seller-scoped Dashboard permissions. */
function requestContext(options: {
  actorType?: "platform_admin" | "seller";
  permissions?: PermissionCode[];
  sellerIds?: string[];
  storeIds?: string[];
  sellerPermissions?: PermissionCode[];
} = {}): RequestContext {
  const sellerIds = options.sellerIds ?? [SELLER_A];
  return {
    requestId: randomUUID(),
    actorId: USER_ID,
    actorType: options.actorType ?? ACTOR_TYPE.SELLER,
    permissions: new Set(options.permissions ?? [DASHBOARD_PERMISSION.READ]),
    sellerIds: new Set(sellerIds),
    storeIds: new Set(options.storeIds ?? [STORE_A]),
    sellerPermissions: new Map(
      sellerIds.map((sellerId) => [
        sellerId,
        new Set(options.sellerPermissions ?? [DASHBOARD_PERMISSION.SELLER_READ]),
      ]),
    ),
    sessionId: randomUUID(),
  };
}

/** Returns a minimal valid Module 20 reader whose methods can be replaced per test. */
function reportsDouble(): DashboardReportsReader {
  return {
    getSalesReport: vi.fn().mockResolvedValue({
      data: {
        summary: {
          orderCount: 1,
          sellerOrderCount: 1,
          gmvByCurrency: [{ currency: "USD", amount: "100.0000" }],
          capturedCashByCurrency: [{ currency: "USD", amount: "100.0000" }],
          refundsByCurrency: [{ currency: "USD", amount: "0.0000" }],
        },
        rows: [],
      },
      meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0 },
    }),
    getSellersReport: vi.fn().mockResolvedValue({
      data: { rows: [] },
      meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }),
    getCommissionsReport: vi.fn().mockResolvedValue({
      data: {
        rows: [],
        marketplaceCommissionRevenueByCurrency: [{ currency: "USD", amount: "10.0000" }],
      },
      meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0 },
    }),
    getPayoutsReport: vi.fn().mockResolvedValue({
      data: {
        rows: [],
        sellerPayableByCurrency: [{ currency: "USD", amount: "90.0000" }],
        paidOutByCurrency: [{ currency: "USD", amount: "20.0000" }],
      },
      meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0 },
    }),
  };
}

/** Returns a data-only Dashboard repository double with safe empty defaults for unrelated methods. */
function repositoryDouble(overrides: Record<string, unknown> = {}): DashboardRepository {
  const repository: Record<string, unknown> = {
    using: vi.fn(),
    findStoreScope: vi.fn().mockResolvedValue({ storeId: STORE_A, sellerId: SELLER_A }),
    findPreferencesByUserId: vi.fn().mockResolvedValue(null),
    listSavedFiltersByUserId: vi.fn().mockResolvedValue([]),
    upsertPreferences: vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000008",
      userId: USER_ID,
      layoutJson: {
        widgets: [{ widgetCode: "executive_kpis", order: 0, visible: true }],
      },
      defaultDateRange: "last_30_days",
      defaultStoreId: STORE_A,
      updatedAt: new Date("2026-09-17T08:00:00.000Z"),
    }),
    replaceSavedFilters: vi.fn().mockResolvedValue([]),
    countLowStockVariants: vi.fn().mockResolvedValue(2),
    countOpenReturns: vi.fn().mockResolvedValue(3),
    countFulfillmentSources: vi.fn().mockResolvedValue(0),
    countPayoutSources: vi.fn().mockResolvedValue(0),
    listLowStockSources: vi.fn().mockResolvedValue([]),
    listFulfillmentSources: vi.fn().mockResolvedValue([]),
    listReturnSources: vi.fn().mockResolvedValue([]),
    listPayoutSources: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  (repository.using as ReturnType<typeof vi.fn>).mockReturnValue(repository);
  return repository as unknown as DashboardRepository;
}

/** Creates a Dashboard service whose transaction/audit/outbox boundaries are harmless unit-test doubles. */
function serviceWith(
  repository: DashboardRepository,
  reports: DashboardReportsReader,
  auditRecord = vi.fn().mockResolvedValue(randomUUID()),
  outboxEnqueue = vi.fn().mockResolvedValue(randomUUID()),
): DashboardService {
  return new DashboardService({
    repository,
    reports,
    transactionRunner: async (work) => work({} as DatabaseTransaction),
    auditUsingTransaction: () => ({ record: auditRecord }),
    outboxUsingTransaction: () => ({ enqueue: outboxEnqueue }),
  });
}

describe("Module 1 Dashboard service", () => {
  it("keeps seller summary reads inside the trusted seller/store scope and hides finance without permission", async () => {
    const repository = repositoryDouble();
    const reports = reportsDouble();
    const service = serviceWith(repository, reports);
    const result = await service.getSummary(requestContext(), {
      sellerId: SELLER_A,
      storeId: STORE_A,
    });

    expect(result).toMatchObject({
      orderCount: 1,
      lowStockVariantCount: 2,
      openReturnCount: 3,
      finance: null,
      scope: { sellerId: SELLER_A, storeId: STORE_A },
    });
    expect(reports.getSalesReport).toHaveBeenCalledTimes(1);
    const [delegatedContext] = vi.mocked(reports.getSalesReport).mock.calls[0] ?? [];
    expect(delegatedContext?.sellerIds.has(SELLER_A)).toBe(true);
    expect(delegatedContext?.sellerIds.has(SELLER_B)).toBe(false);
    expect(delegatedContext?.storeIds.has(STORE_A)).toBe(true);
  });

  it("keeps captured cash, refunds, commission revenue, seller payable and payouts separate for finance readers", async () => {
    const service = serviceWith(repositoryDouble(), reportsDouble());
    const result = await service.getSummary(
      requestContext({
        actorType: "platform_admin",
        permissions: [DASHBOARD_PERMISSION.READ, DASHBOARD_PERMISSION.FINANCE_READ],
        sellerIds: [],
        storeIds: [],
      }),
      {},
    );

    expect(result.finance).toEqual({
      capturedCashByCurrency: [{ currency: "USD", amount: "100.0000" }],
      refundedPaymentsByCurrency: [{ currency: "USD", amount: "0.0000" }],
      marketplaceCommissionRevenueByCurrency: [{ currency: "USD", amount: "10.0000" }],
      sellerPayableByCurrency: [{ currency: "USD", amount: "90.0000" }],
      sellerPayoutsPaidByCurrency: [{ currency: "USD", amount: "20.0000" }],
    });
  });

  it("rejects a foreign seller before a report source can be queried", async () => {
    const reports = reportsDouble();
    const service = serviceWith(repositoryDouble(), reports);

    await expect(
      service.getSummary(requestContext(), { sellerId: SELLER_B }),
    ).rejects.toMatchObject({ code: DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN });
    expect(reports.getSalesReport).not.toHaveBeenCalled();
  });

  it("rejects historical category filtering instead of silently joining mutable Product taxonomy", async () => {
    const service = serviceWith(repositoryDouble(), reportsDouble());

    await expect(
      service.getOrders(requestContext(), { categoryId: randomUUID() }),
    ).rejects.toMatchObject({ code: DASHBOARD_ERROR_CODE.WIDGET_UNAVAILABLE });
  });

  it("builds order status counts by unique parent Order while summing Seller Order GMV", async () => {
    const reports = reportsDouble();
    vi.mocked(reports.getSalesReport).mockResolvedValue({
      data: {
        summary: {
          orderCount: 1,
          sellerOrderCount: 2,
          gmvByCurrency: [{ currency: "USD", amount: "100.0000" }],
          capturedCashByCurrency: [{ currency: "USD", amount: "100.0000" }],
          refundsByCurrency: [],
        },
        rows: [
          {
            orderId: ORDER_A,
            orderNo: "ORD-A",
            sellerOrderId: SELLER_ORDER_A,
            sellerOrderNo: "SOR-A",
            sellerId: SELLER_A,
            storeId: STORE_A,
            orderStatus: "confirmed",
            sellerOrderStatus: "pending_acceptance",
            currency: "USD",
            grandTotal: "60.0000",
            createdAt: "2026-09-17T08:00:00.000Z",
          },
          {
            orderId: ORDER_A,
            orderNo: "ORD-A",
            sellerOrderId: SELLER_ORDER_B,
            sellerOrderNo: "SOR-B",
            sellerId: SELLER_A,
            storeId: STORE_A,
            orderStatus: "confirmed",
            sellerOrderStatus: "pending_acceptance",
            currency: "USD",
            grandTotal: "40.0000",
            createdAt: "2026-09-17T08:00:00.000Z",
          },
        ],
      },
      meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
    });
    const service = serviceWith(repositoryDouble(), reports);
    const result = await service.getOrders(requestContext(), {});

    expect(result.statusCounts.find((item) => item.status === "confirmed")?.count).toBe(1);
    expect(result.trend).toEqual([
      {
        bucketStart: "2026-09-17T00:00:00.000Z",
        currency: "USD",
        orderCount: 1,
        gmv: "100.0000",
      },
    ]);
  });

  it("updates preferences atomically with one audit row and one durable event", async () => {
    const repository = repositoryDouble();
    const reports = reportsDouble();
    const auditRecord = vi.fn().mockResolvedValue(randomUUID());
    const outboxEnqueue = vi.fn().mockResolvedValue(randomUUID());
    const service = serviceWith(repository, reports, auditRecord, outboxEnqueue);
    const context = requestContext({
      permissions: [DASHBOARD_PERMISSION.READ, DASHBOARD_PERMISSION.MANAGE_PREFERENCES],
    });

    const result = await service.updatePreferences(context, {
      defaultStoreId: STORE_A,
      defaultDateRange: "last_30_days",
      layout: {
        widgets: [{ widgetCode: "executive_kpis", order: 0, visible: true }],
      },
    });

    expect(result.defaultStoreId).toBe(STORE_A);
    expect(repository.upsertPreferences).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dashboard.preferences_updated", actorId: USER_ID }),
    );
    expect(outboxEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "dashboard.preferences_updated" }),
    );
  });
});
