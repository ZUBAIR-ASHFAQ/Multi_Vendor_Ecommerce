import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError, isAppError } from "../../common/errors/app-error.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { PAGINATION } from "../../common/constants/pagination.js";
import { withTransaction } from "../../database/transaction.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { ORDER_STATUS_VALUES, SELLER_ORDER_STATUS } from "../orders/orders.constants.js";
import { REPORTS_ERROR_CODE, REPORTS_PERMISSION } from "../reports/reports.constants.js";
import type {
  CommissionsReportQuery,
  PayoutsReportQuery,
  SalesReportQuery,
  SellersReportQuery,
} from "../reports/reports.schema.js";
import type { ReportsService } from "../reports/reports.service.js";
import { RETURN_REQUEST_STATUS } from "../returns-refunds/returns-refunds.constants.js";
import { PAYOUT_STATUS } from "../seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { SHIPMENT_STATUS } from "../shipping/shipping.constants.js";
import {
  DASHBOARD_AUDIT_ACTION,
  DASHBOARD_DATE_RANGE,
  DASHBOARD_ERROR_CODE,
  DASHBOARD_OUTBOX_EVENT,
  DASHBOARD_PERMISSION,
  DASHBOARD_WIDGET_VALUES,
} from "./dashboard.constants.js";
import {
  dashboardFilterSchema,
  dashboardLayoutSchema,
  dashboardDateRangePresetSchema,
  updateDashboardPreferencesBodySchema,
  type DashboardAlertsQuery,
  type DashboardAlertsResponse,
  type DashboardFilter,
  type DashboardOrdersQuery,
  type DashboardOrdersResponse,
  type DashboardPreferencesResponse,
  type DashboardSellersQuery,
  type DashboardSellersResponse,
  type DashboardSummaryQuery,
  type DashboardSummaryResponse,
  type UpdateDashboardPreferencesBody,
} from "./dashboard.schema.js";
import {
  DashboardRepository,
  type DashboardReadScope,
  type DashboardSavedFilterWriteInput,
} from "./dashboard.repository.js";

const OPEN_RETURN_STATUSES = [
  RETURN_REQUEST_STATUS.REQUESTED,
  RETURN_REQUEST_STATUS.APPROVED,
  RETURN_REQUEST_STATUS.RECEIVED,
] as const;

const FULFILLMENT_SELLER_ORDER_ALERT_STATUSES = [
  SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
] as const;

const FULFILLMENT_SHIPMENT_ALERT_STATUSES = [SHIPMENT_STATUS.CREATED] as const;

const PAYOUT_ALERT_STATUSES = [
  PAYOUT_STATUS.REQUESTED,
  PAYOUT_STATUS.APPROVED,
  PAYOUT_STATUS.PROCESSING,
  PAYOUT_STATUS.FAILED,
] as const;

/** Minimal Module 20 read surface reused by Dashboard so KPI definitions are not duplicated. */
export type DashboardReportsReader = Pick<
  ReportsService,
  | "getSalesReport"
  | "getSellersReport"
  | "getCommissionsReport"
  | "getPayoutsReport"
>;

/** Runs one Dashboard write inside a caller-provided PostgreSQL transaction. */
export type DashboardTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Small audit boundary used by Dashboard preference writes. */
export interface DashboardAuditIntegration {
  /** Appends one immutable redacted Dashboard audit event. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Small outbox boundary used by Dashboard preference writes. */
export interface DashboardOutboxIntegration {
  /** Appends one durable Dashboard event in the same business transaction. */
  enqueue<TPayload>(event: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit service dependencies keep Dashboard orchestration simple to test. */
export interface DashboardServiceDependencies {
  reports: DashboardReportsReader;
  repository?: DashboardRepository;
  transactionRunner?: DashboardTransactionRunner;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => DashboardAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => DashboardOutboxIntegration;
}

/** One paged Dashboard result whose metadata belongs in the standard API envelope. */
export interface DashboardPagedResult<T> {
  data: T;
  meta: PaginationMeta;
}

/** Scope resolved from trusted request context before any source repository or report read. */
interface ResolvedDashboardScope {
  repositoryScope: DashboardReadScope;
  sellerId: string | null;
  storeId: string | null;
}

/** Mutable daily trend accumulator kept internal so order ids can be deduplicated safely. */
interface TrendAccumulator {
  bucketStart: string;
  currency: string;
  orderIds: Set<string>;
  gmvScale4: bigint;
}

/** Creates one stable Dashboard application error. */
function dashboardError(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown,
  cause?: unknown,
): AppError {
  return new AppError({
    code,
    message,
    statusCode,
    ...(details !== undefined ? { details } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

/** Converts an exact scale-4 money string to an integer without floating-point arithmetic. */
function moneyToScale4(value: string): bigint {
  const normalized = value.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const amount = BigInt(whole || "0") * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4) || "0");
  return negative ? -amount : amount;
}

/** Converts an exact scale-4 integer back to the marketplace money transport format. */
function scale4ToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 10_000n;
  const fraction = (absolute % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Returns a fresh default layout so callers cannot mutate shared constant state. */
function defaultDashboardLayout(): DashboardPreferencesResponse["layout"] {
  return {
    widgets: DASHBOARD_WIDGET_VALUES.map((widgetCode, order) => ({
      widgetCode,
      order,
      visible: true,
    })),
  };
}

/** Returns a UTC day bucket start for deterministic order/GMV trend aggregation. */
function utcDayBucket(value: string): string {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

/** Module 1 business service coordinating report reads, resource scope, alerts and preferences. */
export class DashboardService {
  private readonly repository: DashboardRepository;
  private readonly reports: DashboardReportsReader;
  private readonly transactionRunner: DashboardTransactionRunner;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => DashboardAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => DashboardOutboxIntegration;

  /** Stores explicit dependencies while keeping infrastructure defaults visible and replaceable in tests. */
  constructor(dependencies: DashboardServiceDependencies) {
    this.repository = dependencies.repository ?? new DashboardRepository();
    this.reports = dependencies.reports;
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
  }

  /** Returns Dashboard KPIs sourced from Module 20 plus current operational counts owned by source modules. */
  async getSummary(
    context: RequestContext,
    query: DashboardSummaryQuery,
  ): Promise<DashboardSummaryResponse> {
    this.assertReadPermission(context);
    this.assertReportBackedFilterSupport(query, "summary");
    const scope = await this.resolveReadScope(context, query);
    const salesContext = this.reportContext(context, scope, [REPORTS_PERMISSION.SALES_READ]);
    const salesQuery = this.salesQuery(query, 1, 1, "created_desc");

    const [sales, lowStockVariantCount, openReturnCount, preferences] = await Promise.all([
      this.readReport(() => this.reports.getSalesReport(salesContext, salesQuery)),
      this.repository.countLowStockVariants(query, scope.repositoryScope),
      this.repository.countOpenReturns(query, scope.repositoryScope, OPEN_RETURN_STATUSES),
      this.getPreferences(context),
    ]);

    let finance: DashboardSummaryResponse["finance"] = null;
    if (this.hasFinancePermission(context)) {
      if (query.storeId) {
        throw this.widgetUnavailable(
          "Seller payable, commission revenue and payout ledgers do not have a safe store-level reporting grain.",
        );
      }
      const financeContext = this.reportContext(context, scope, [REPORTS_PERMISSION.FINANCE_READ]);
      const [commissions, payouts] = await Promise.all([
        this.readReport(() =>
          this.reports.getCommissionsReport(financeContext, this.commissionsQuery(query)),
        ),
        this.readReport(() =>
          this.reports.getPayoutsReport(financeContext, this.payoutsQuery(query)),
        ),
      ]);
      finance = {
        capturedCashByCurrency: sales.data.summary.capturedCashByCurrency,
        refundedPaymentsByCurrency: sales.data.summary.refundsByCurrency,
        marketplaceCommissionRevenueByCurrency:
          commissions.data.marketplaceCommissionRevenueByCurrency,
        sellerPayableByCurrency: payouts.data.sellerPayableByCurrency,
        sellerPayoutsPaidByCurrency: payouts.data.paidOutByCurrency,
      };
    }

    return {
      scope: this.scopeResponse(query, scope),
      orderCount: sales.data.summary.orderCount,
      lowStockVariantCount,
      openReturnCount,
      gmvByCurrency: sales.data.summary.gmvByCurrency,
      finance,
      preferences,
    };
  }

  /** Returns finalized order status counts and a UTC daily GMV trend from Module 20 Sales rows. */
  async getOrders(
    context: RequestContext,
    query: DashboardOrdersQuery,
  ): Promise<DashboardOrdersResponse> {
    this.assertReadPermission(context);
    this.assertReportBackedFilterSupport(query, "orders");
    const scope = await this.resolveReadScope(context, query);
    const reportContext = this.reportContext(context, scope, [REPORTS_PERMISSION.SALES_READ]);
    const rows = await this.loadAllSalesRows(reportContext, query);

    const statusOrderIds = new Map<string, Set<string>>(
      ORDER_STATUS_VALUES.map((status) => [status, new Set<string>()]),
    );
    const trend = new Map<string, TrendAccumulator>();

    for (const row of rows) {
      statusOrderIds.get(row.orderStatus)?.add(row.orderId);
      const bucketStart = utcDayBucket(row.createdAt);
      const key = `${bucketStart}:${row.currency}`;
      const current = trend.get(key) ?? {
        bucketStart,
        currency: row.currency,
        orderIds: new Set<string>(),
        gmvScale4: 0n,
      };
      current.orderIds.add(row.orderId);
      current.gmvScale4 += moneyToScale4(row.grandTotal);
      trend.set(key, current);
    }

    return {
      scope: this.scopeResponse(query, scope),
      statusCounts: ORDER_STATUS_VALUES.map((status) => ({
        status,
        count: statusOrderIds.get(status)?.size ?? 0,
      })),
      trend: [...trend.values()]
        .sort(
          (left, right) =>
            left.bucketStart.localeCompare(right.bucketStart)
            || left.currency.localeCompare(right.currency),
        )
        .map((point) => ({
          bucketStart: point.bucketStart,
          currency: point.currency,
          orderCount: point.orderIds.size,
          gmv: scale4ToMoney(point.gmvScale4),
        })),
    };
  }

  /** Returns the Module 20 seller-performance page while hiding finance fields without Dashboard finance permission. */
  async getSellers(
    context: RequestContext,
    query: DashboardSellersQuery,
  ): Promise<DashboardPagedResult<DashboardSellersResponse>> {
    this.assertReadPermission(context);
    this.assertSellerReadPermission(context);
    if (query.storeId || query.categoryId) {
      throw this.widgetUnavailable(
        "Seller performance is seller-grain reporting and cannot safely apply store or current-category filters.",
      );
    }
    const scope = await this.resolveReadScope(context, query);
    const reportContext = this.reportContext(context, scope, [REPORTS_PERMISSION.SELLER_READ]);
    const result = await this.readReport(() =>
      this.reports.getSellersReport(reportContext, this.sellersQuery(query)),
    );
    const showFinance = this.hasFinancePermission(context);

    return {
      data: {
        scope: this.scopeResponse(query, scope),
        rows: result.data.rows.map((row) => ({
          sellerId: row.sellerId,
          sellerName: row.sellerName,
          orderCount: row.orderCount,
          currency: row.currency,
          gmv: row.gmv,
          finance: showFinance
            ? {
                commissionRevenue: row.commissionRevenue,
                sellerPayable: row.sellerPayable,
                refunds: row.refunds,
                payouts: row.payouts,
              }
            : null,
        })),
      },
      meta: result.meta,
    };
  }

  /** Returns a globally ordered page of source-owned operational alerts without duplicating source state. */
  async getAlerts(
    context: RequestContext,
    query: DashboardAlertsQuery,
  ): Promise<DashboardPagedResult<DashboardAlertsResponse>> {
    this.assertReadPermission(context);
    const scope = await this.resolveReadScope(context, query);
    const offset = (query.page - 1) * query.pageSize;
    const candidateLimit = offset + query.pageSize;
    const categoryOnly = Boolean(query.categoryId);
    const includePayouts = !query.storeId && !query.categoryId && this.hasFinancePermission(context);

    const [lowStockCount, lowStockRows, fulfillmentCount, fulfillmentRows, returnCount, returnRows, payoutCount, payoutRows] =
      await Promise.all([
        this.repository.countLowStockVariants(query, scope.repositoryScope),
        this.repository.listLowStockSources(query, scope.repositoryScope, candidateLimit),
        categoryOnly
          ? Promise.resolve(0)
          : this.repository.countFulfillmentSources(
              query,
              scope.repositoryScope,
              FULFILLMENT_SELLER_ORDER_ALERT_STATUSES,
              FULFILLMENT_SHIPMENT_ALERT_STATUSES,
            ),
        categoryOnly
          ? Promise.resolve([])
          : this.repository.listFulfillmentSources(
              query,
              scope.repositoryScope,
              FULFILLMENT_SELLER_ORDER_ALERT_STATUSES,
              FULFILLMENT_SHIPMENT_ALERT_STATUSES,
              candidateLimit,
            ),
        categoryOnly
          ? Promise.resolve(0)
          : this.repository.countOpenReturns(query, scope.repositoryScope, OPEN_RETURN_STATUSES),
        categoryOnly
          ? Promise.resolve([])
          : this.repository.listReturnSources(
              query,
              scope.repositoryScope,
              OPEN_RETURN_STATUSES,
              candidateLimit,
            ),
        includePayouts
          ? this.repository.countPayoutSources(query, scope.repositoryScope, PAYOUT_ALERT_STATUSES)
          : Promise.resolve(0),
        includePayouts
          ? this.repository.listPayoutSources(
              query,
              scope.repositoryScope,
              PAYOUT_ALERT_STATUSES,
              candidateLimit,
            )
          : Promise.resolve([]),
      ]);

    const rows: DashboardAlertsResponse["rows"] = [
      ...lowStockRows.map((row) => ({
        type: "low_stock" as const,
        sellerId: row.sellerId,
        storeId: row.storeId,
        resourceId: row.inventoryItemId,
        title: `Low stock: ${row.sku}`,
        message: `${row.availableQty} available; reorder level ${row.reorderLevel}.`,
        occurredAt: row.updatedAt.toISOString(),
      })),
      ...fulfillmentRows.map((row) => ({
        type: "fulfillment_attention" as const,
        sellerId: row.sellerId,
        storeId: row.storeId,
        resourceId: row.shipmentId ?? row.sellerOrderId,
        title: `Fulfillment attention: ${row.sellerOrderNo}`,
        message: row.shipmentStatus
          ? `Shipment status is ${row.shipmentStatus}.`
          : `Seller order status is ${row.status}.`,
        occurredAt: row.occurredAt.toISOString(),
      })),
      ...returnRows.map((row) => ({
        type: "return_attention" as const,
        sellerId: row.sellerId,
        storeId: row.storeId,
        resourceId: row.returnRequestId,
        title: `Return attention: ${row.returnNo}`,
        message: `Return status is ${row.status}.`,
        occurredAt: row.occurredAt.toISOString(),
      })),
      ...payoutRows.map((row) => ({
        type: "payout_attention" as const,
        sellerId: row.sellerId,
        storeId: null,
        resourceId: row.payoutId,
        title: `Payout attention: ${row.payoutNo}`,
        message: `${row.currency} ${row.amount} payout status is ${row.status}.`,
        occurredAt: row.occurredAt.toISOString(),
      })),
    ].sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt)
        || left.type.localeCompare(right.type)
        || left.resourceId.localeCompare(right.resourceId),
    );

    const totalItems = lowStockCount + fulfillmentCount + returnCount + payoutCount;
    return {
      data: {
        scope: this.scopeResponse(query, scope),
        rows: rows.slice(offset, offset + query.pageSize),
      },
      meta: paginationMeta(query, totalItems),
    };
  }

  /** Atomically updates the actor's Dashboard preferences, saved filters, audit row and durable event. */
  async updatePreferences(
    context: RequestContext,
    input: UpdateDashboardPreferencesBody,
  ): Promise<DashboardPreferencesResponse> {
    const actorId = this.requireActor(context);
    if (!context.permissions.has(DASHBOARD_PERMISSION.MANAGE_PREFERENCES)) {
      throw this.scopeForbidden();
    }
    const parsed = updateDashboardPreferencesBodySchema.safeParse(input);
    if (!parsed.success) {
      throw this.filterInvalid(parsed.error.flatten());
    }
    const command = parsed.data;
    const currentPreference = await this.repository.findPreferencesByUserId(actorId);
    const currentSavedFilters = await this.repository.listSavedFiltersByUserId(actorId);
    const current = this.preferenceResponse(currentPreference, currentSavedFilters);

    const defaultStoreId =
      command.defaultStoreId !== undefined ? command.defaultStoreId : current.defaultStoreId;
    if (defaultStoreId) {
      await this.assertPreferenceStoreScope(context, defaultStoreId);
    }
    if (command.savedFilters) {
      for (const savedFilter of command.savedFilters) {
        await this.assertPreferenceFilterScope(context, savedFilter.filters);
      }
    }

    const writeInput = {
      layoutJson: command.layout ?? current.layout,
      defaultDateRange: command.defaultDateRange ?? current.defaultDateRange,
      defaultStoreId,
    };
    const savedFilterInputs: DashboardSavedFilterWriteInput[] | null = command.savedFilters
      ? command.savedFilters.map((savedFilter) => ({
          name: savedFilter.name,
          filterJson: savedFilter.filters,
        }))
      : null;

    return this.transactionRunner(async (transaction) => {
      const repository = this.repository.using(transaction);
      const preference = await repository.upsertPreferences(actorId, writeInput);
      const savedFilters = savedFilterInputs
        ? await repository.replaceSavedFilters(actorId, savedFilterInputs)
        : await repository.listSavedFiltersByUserId(actorId);
      const after = this.preferenceResponse(preference, savedFilters);

      await this.auditUsingTransaction(transaction).record({
        actorId,
        actorType: context.actorType,
        action: DASHBOARD_AUDIT_ACTION.PREFERENCES_UPDATED,
        entityType: "dashboard_preferences",
        entityId: preference.id,
        requestId: context.requestId,
        before: current,
        after,
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: DASHBOARD_OUTBOX_EVENT.PREFERENCES_UPDATED,
        aggregateType: "dashboard_preferences",
        aggregateId: preference.id,
        payload: { userId: actorId },
      });
      return after;
    });
  }

  /** Returns the actor's effective preferences without creating database state during a read. */
  private async getPreferences(context: RequestContext): Promise<DashboardPreferencesResponse> {
    const actorId = this.requireActor(context);
    const [preference, savedFilters] = await Promise.all([
      this.repository.findPreferencesByUserId(actorId),
      this.repository.listSavedFiltersByUserId(actorId),
    ]);
    return this.preferenceResponse(preference, savedFilters);
  }

  /** Converts optional persistence rows into validated effective Dashboard preferences. */
  private preferenceResponse(
    preference: Awaited<ReturnType<DashboardRepository["findPreferencesByUserId"]>>,
    savedFilters: Awaited<ReturnType<DashboardRepository["listSavedFiltersByUserId"]>>,
  ): DashboardPreferencesResponse {
    const layout = preference
      ? dashboardLayoutSchema.safeParse(preference.layoutJson)
      : { success: true as const, data: defaultDashboardLayout() };
    const dateRange = preference
      ? dashboardDateRangePresetSchema.safeParse(preference.defaultDateRange)
      : { success: true as const, data: DASHBOARD_DATE_RANGE.LAST_30_DAYS };
    if (!layout.success || !dateRange.success) {
      throw this.widgetUnavailable("Stored Dashboard preference data is unavailable.");
    }

    const parsedSavedFilters = savedFilters.map((savedFilter) => {
      const filters = dashboardFilterSchema.safeParse(savedFilter.filterJson);
      if (!filters.success) {
        throw this.widgetUnavailable("Stored Dashboard saved-filter data is unavailable.");
      }
      return {
        id: savedFilter.id,
        name: savedFilter.name,
        filters: filters.data,
        createdAt: savedFilter.createdAt.toISOString(),
      };
    });

    return {
      id: preference?.id ?? null,
      layout: layout.data,
      defaultDateRange: dateRange.data,
      defaultStoreId: preference?.defaultStoreId ?? null,
      savedFilters: parsedSavedFilters,
      updatedAt: preference?.updatedAt.toISOString() ?? null,
    };
  }

  /** Requires the documented Dashboard read permission before any private KPI or alert read. */
  private assertReadPermission(context: RequestContext): void {
    this.requireActor(context);
    if (!context.permissions.has(DASHBOARD_PERMISSION.READ)) {
      throw this.scopeForbidden();
    }
  }

  /** Requires seller-performance permission in addition to the base Dashboard read permission. */
  private assertSellerReadPermission(context: RequestContext): void {
    if (!context.permissions.has(DASHBOARD_PERMISSION.SELLER_READ)) {
      throw this.scopeForbidden();
    }
  }

  /** Returns whether the actor may see finance-sensitive Dashboard values. */
  private hasFinancePermission(context: RequestContext): boolean {
    return context.permissions.has(DASHBOARD_PERMISSION.FINANCE_READ);
  }

  /** Resolves platform or seller Dashboard scope and rejects foreign seller/store narrowing. */
  private async resolveReadScope(
    context: RequestContext,
    filter: Pick<DashboardFilter, "sellerId" | "storeId">,
  ): Promise<ResolvedDashboardScope> {
    if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
      if (filter.storeId) {
        const store = await this.repository.findStoreScope(filter.storeId);
        if (!store) throw this.scopeForbidden();
        if (filter.sellerId && filter.sellerId !== store.sellerId) throw this.scopeForbidden();
      }
      return {
        repositoryScope: {
          sellerIds: filter.sellerId ? [filter.sellerId] : null,
          storeIds: filter.storeId ? [filter.storeId] : null,
        },
        sellerId: filter.sellerId ?? null,
        storeId: filter.storeId ?? null,
      };
    }

    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.scopeForbidden();
    const allowedSellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId)
          && permissions.has(DASHBOARD_PERMISSION.SELLER_READ),
      )
      .map(([sellerId]) => sellerId);
    if (allowedSellerIds.length === 0) throw this.scopeForbidden();
    if (filter.sellerId && !allowedSellerIds.includes(filter.sellerId)) {
      throw this.scopeForbidden();
    }

    let storeIds = [...context.storeIds];
    if (filter.storeId) {
      if (!context.storeIds.has(filter.storeId)) throw this.scopeForbidden();
      const store = await this.repository.findStoreScope(filter.storeId);
      if (!store || !allowedSellerIds.includes(store.sellerId)) throw this.scopeForbidden();
      if (filter.sellerId && filter.sellerId !== store.sellerId) throw this.scopeForbidden();
      storeIds = [filter.storeId];
    }

    const sellerIds = filter.sellerId ? [filter.sellerId] : allowedSellerIds;
    return {
      repositoryScope: { sellerIds, storeIds },
      sellerId: filter.sellerId ?? (sellerIds.length === 1 ? sellerIds[0] ?? null : null),
      storeId: filter.storeId ?? (storeIds.length === 1 ? storeIds[0] ?? null : null),
    };
  }

  /** Creates a trusted internal Reports context limited to the Dashboard-resolved actor scope and source permissions. */
  private reportContext(
    context: RequestContext,
    scope: ResolvedDashboardScope,
    reportPermissions: readonly PermissionCode[],
  ): RequestContext {
    const permissions = new Set<PermissionCode>([...context.permissions, ...reportPermissions]);
    const sellerIds = new Set(scope.repositoryScope.sellerIds ?? [...context.sellerIds]);
    const storeIds = new Set(scope.repositoryScope.storeIds ?? [...context.storeIds]);
    const sellerPermissions = new Map<string, ReadonlySet<PermissionCode>>();

    for (const sellerId of sellerIds) {
      sellerPermissions.set(
        sellerId,
        new Set<PermissionCode>([
          ...(context.sellerPermissions.get(sellerId) ?? []),
          ...reportPermissions,
        ]),
      );
    }

    return {
      ...context,
      permissions,
      sellerIds,
      storeIds,
      sellerPermissions,
    };
  }

  /** Maps a Dashboard filter to the existing Module 20 Sales query without inventing new report dimensions. */
  private salesQuery(
    query: DashboardSummaryQuery | DashboardOrdersQuery,
    page: number,
    pageSize: number,
    sort: SalesReportQuery["sort"],
  ): SalesReportQuery {
    return {
      page,
      pageSize,
      sort,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
    };
  }

  /** Maps a Dashboard seller query to the stable Module 20 seller-performance query. */
  private sellersQuery(query: DashboardSellersQuery): SellersReportQuery {
    return {
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
    };
  }

  /** Builds the Module 20 Commission query used only for finance-authorized Dashboard summaries. */
  private commissionsQuery(query: DashboardSummaryQuery): CommissionsReportQuery {
    return {
      page: 1,
      pageSize: 1,
      sort: "occurred_desc",
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
    };
  }

  /** Builds the Module 20 Payout query used only for finance-authorized Dashboard summaries. */
  private payoutsQuery(query: DashboardSummaryQuery): PayoutsReportQuery {
    return {
      page: 1,
      pageSize: 1,
      sort: "requested_desc",
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
    };
  }

  /** Loads every bounded Module 20 Sales page needed to construct the Dashboard trend without new SQL definitions. */
  private async loadAllSalesRows(
    context: RequestContext,
    query: DashboardOrdersQuery,
  ): Promise<Awaited<ReturnType<DashboardReportsReader["getSalesReport"]>>["data"]["rows"]> {
    const rows: Awaited<ReturnType<DashboardReportsReader["getSalesReport"]>>["data"]["rows"] = [];
    let page = 1;
    while (true) {
      const result = await this.readReport(() =>
        this.reports.getSalesReport(
          context,
          this.salesQuery(query, page, PAGINATION.MAX_PAGE_SIZE, "created_asc"),
        ),
      );
      rows.push(...result.data.rows);
      if (page >= result.meta.totalPages) break;
      page += 1;
    }
    return rows;
  }

  /** Returns the effective filter scope echoed to the Dashboard client for transparent server-side narrowing. */
  private scopeResponse(
    query: DashboardFilter,
    scope: ResolvedDashboardScope,
  ): DashboardSummaryResponse["scope"] {
    return {
      sellerId: scope.sellerId,
      storeId: scope.storeId,
      categoryId: query.categoryId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    };
  }

  /** Rejects current-category filters for historical report-backed widgets rather than silently using mutable Product data. */
  private assertReportBackedFilterSupport(
    query: Pick<DashboardFilter, "categoryId">,
    widget: string,
  ): void {
    if (query.categoryId) {
      throw this.widgetUnavailable(
        `The ${widget} widget cannot safely apply category filtering because historical Orders do not snapshot category.`,
      );
    }
  }

  /** Verifies a preferred default store exists and remains inside the authenticated actor's resource scope. */
  private async assertPreferenceStoreScope(
    context: RequestContext,
    storeId: string,
  ): Promise<void> {
    const store = await this.repository.findStoreScope(storeId);
    if (!store) throw this.scopeForbidden();
    if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) return;
    if (
      context.actorType !== ACTOR_TYPE.SELLER
      || !context.storeIds.has(storeId)
      || !context.sellerIds.has(store.sellerId)
      || !context.sellerPermissions.get(store.sellerId)?.has(DASHBOARD_PERMISSION.SELLER_READ)
    ) {
      throw this.scopeForbidden();
    }
  }

  /** Verifies seller/store values embedded in one saved filter before persisting the user's preset. */
  private async assertPreferenceFilterScope(
    context: RequestContext,
    filter: DashboardFilter,
  ): Promise<void> {
    if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
      if (filter.storeId) {
        const store = await this.repository.findStoreScope(filter.storeId);
        if (!store || (filter.sellerId && store.sellerId !== filter.sellerId)) {
          throw this.scopeForbidden();
        }
      }
      return;
    }
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.scopeForbidden();
    if (
      filter.sellerId
      && (
        !context.sellerIds.has(filter.sellerId)
        || !context.sellerPermissions.get(filter.sellerId)?.has(DASHBOARD_PERMISSION.SELLER_READ)
      )
    ) {
      throw this.scopeForbidden();
    }
    if (filter.storeId) {
      if (!context.storeIds.has(filter.storeId)) throw this.scopeForbidden();
      const store = await this.repository.findStoreScope(filter.storeId);
      if (
        !store
        || !context.sellerIds.has(store.sellerId)
        || !context.sellerPermissions.get(store.sellerId)?.has(DASHBOARD_PERMISSION.SELLER_READ)
        || (filter.sellerId && filter.sellerId !== store.sellerId)
      ) {
        throw this.scopeForbidden();
      }
    }
  }

  /** Converts Module 20 read failures into stable Dashboard source/scope errors without leaking internals. */
  private async readReport<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (isAppError(error)) {
        if (error.code === REPORTS_ERROR_CODE.SCOPE_FORBIDDEN) throw this.scopeForbidden();
        if (error.code === REPORTS_ERROR_CODE.FILTER_INVALID) throw this.filterInvalid(error.details);
      }
      throw this.widgetUnavailable("A required reporting source is unavailable.", error);
    }
  }

  /** Requires a real authenticated user id for every Dashboard read/write. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw dashboardError("UNAUTHENTICATED", "Authentication is required.", 401);
    }
    return context.actorId;
  }

  /** Creates the stable Dashboard scope error without revealing whether a foreign resource exists. */
  private scopeForbidden(): AppError {
    return dashboardError(
      DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN,
      "The requested Dashboard scope is not allowed.",
      403,
    );
  }

  /** Creates the stable Dashboard unavailable-widget/source error. */
  private widgetUnavailable(message: string, cause?: unknown): AppError {
    return dashboardError(
      DASHBOARD_ERROR_CODE.WIDGET_UNAVAILABLE,
      message,
      503,
      undefined,
      cause,
    );
  }

  /** Creates the stable Dashboard invalid-filter error for service-level validation failures. */
  private filterInvalid(details?: unknown): AppError {
    return dashboardError(
      DASHBOARD_ERROR_CODE.FILTER_INVALID,
      "The Dashboard filter is invalid.",
      422,
      details,
    );
  }
}
