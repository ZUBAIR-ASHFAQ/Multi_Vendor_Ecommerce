import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import { auditLogs } from "../../database/schema/audit.js";
import { commissionEntries } from "../../database/schema/commissions.js";
import { inventoryItems } from "../../database/schema/inventory.js";
import { orders, sellerOrders } from "../../database/schema/orders.js";
import { payments } from "../../database/schema/payments.js";
import { productVariants } from "../../database/schema/products.js";
import {
  reportDefinitions,
  reportRuns,
  type ReportDefinitionRow,
  type ReportRunRow,
} from "../../database/schema/reports.js";
import { refunds, returnRequests } from "../../database/schema/returns-refunds.js";
import { sellerWalletEntries, payouts } from "../../database/schema/seller-wallet-payouts.js";
import { sellers, stores } from "../../database/schema/sellers.js";
import type { DatabaseExecutor } from "../../database/types.js";
import type {
  CommissionsReportQuery,
  InventoryReportQuery,
  PayoutsReportQuery,
  RefundsReportQuery,
  ReportRunListQuery,
  SalesReportQuery,
} from "./reports.schema.js";

/** Mandatory repository scope supplied by the Reports service after authorization has been resolved. */
export interface ReportsReadScope {
  sellerIds: readonly string[] | null;
  storeIds: readonly string[] | null;
}

/** Minimal common date/currency filters used by report export and aggregate reads. */
export interface ReportsFinancialFilter {
  from?: string | undefined;
  to?: string | undefined;
  currency?: string | undefined;
}

/** Seller-scoped extension shared by report export/read-model queries. */
export interface ReportsSellerFinancialFilter extends ReportsFinancialFilter {
  sellerId?: string | undefined;
  storeId?: string | undefined;
}

/** One page of rows plus its full filtered row count. */
export interface ReportsPage<Row> {
  items: Row[];
  totalItems: number;
}

/** Seller/store ownership record used only to validate a requested reporting scope. */
export interface ReportStoreScopeRow {
  storeId: string;
  sellerId: string;
}

/** Raw Seller Order grain returned for the Sales report. */
export interface SalesReportRecord {
  orderId: string;
  orderNo: string;
  sellerOrderId: string;
  sellerOrderNo: string;
  sellerId: string;
  storeId: string;
  orderStatus: string;
  sellerOrderStatus: string;
  currency: string;
  grandTotal: string;
  createdAt: Date;
}

/** One exact currency aggregate returned by PostgreSQL. */
export interface CurrencyAggregateRow {
  currency: string;
  amount: string;
}

/** Minimal Seller identity row used to label Seller Performance aggregates without leaking seller persistence. */
export interface ReportSellerDirectoryRow {
  sellerId: string;
  sellerName: string;
}

/** One seller/currency Sales aggregate used by the service to define GMV/order KPIs. */
export interface SellerSalesAggregateRow {
  sellerId: string;
  sellerName: string;
  currency: string;
  orderCount: number;
  gmv: string;
}

/** One seller/currency Commission aggregate. Signed values preserve immutable refund/adjustment ledger semantics. */
export interface SellerCommissionAggregateRow {
  sellerId: string;
  currency: string;
  commissionRevenue: string;
}

/** One seller/currency Wallet bucket aggregate reconstructed from the immutable Wallet ledger. */
export interface SellerWalletAggregateRow {
  sellerId: string;
  currency: string;
  sellerPayable: string;
}

/** One seller/currency completed Refund aggregate. */
export interface SellerRefundAggregateRow {
  sellerId: string;
  currency: string;
  refunds: string;
}

/** One seller/currency paid Payout aggregate. */
export interface SellerPayoutAggregateRow {
  sellerId: string;
  currency: string;
  payouts: string;
}

/** Current Inventory row used by the Inventory/low-stock report. */
export interface InventoryReportRecord {
  inventoryItemId: string;
  sellerId: string;
  storeId: string;
  variantId: string;
  sku: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  reorderLevel: number | null;
  lowStock: boolean;
  updatedAt: Date;
}

/** Return-linked Refund row with deterministic seller/store attribution. */
export interface RefundReportRecord {
  refundId: string;
  returnRequestId: string | null;
  orderId: string;
  sellerId: string;
  storeId: string;
  status: string;
  currency: string;
  amount: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Immutable Commission ledger row used by the Commission report. */
export interface CommissionReportRecord {
  commissionEntryId: string;
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  entryType: string;
  currency: string;
  grossAmount: string;
  commissionAmount: string;
  sellerNetAmount: string;
  occurredAt: Date;
}

/** Seller Payout row with provider secrets intentionally omitted. */
export interface PayoutReportRecord {
  payoutId: string;
  payoutNo: string;
  sellerId: string;
  status: string;
  currency: string;
  amount: string;
  requestedAt: Date;
  processedAt: Date | null;
}

/** Audit row used only by the approved Module 20 asynchronous audit export. */
export interface AuditExportRecord {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  sellerId: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** Validated service input for one new asynchronous report run. */
export interface CreateReportRunRecordInput {
  reportCode: string;
  requestedBy: string;
  filtersJson: Record<string, unknown>;
  outputFormat: string;
}

/** Combines optional Drizzle predicates while keeping report queries readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length > 0 ? and(...active) : undefined;
}

/** Converts a mandatory seller scope into a SQL predicate; null means platform-wide. */
function sellerScopeCondition(
  column: AnyPgColumn,
  sellerIds: readonly string[] | null,
): SQL | undefined {
  if (sellerIds === null) return undefined;
  if (sellerIds.length === 0) return sql`false`;
  if (sellerIds.length === 1) return eq(column, sellerIds[0] as string);
  return inArray(column, [...sellerIds]);
}

/** Converts a mandatory store scope into a SQL predicate; null means all stores in the allowed seller scope. */
function storeScopeCondition(
  column: AnyPgColumn,
  storeIds: readonly string[] | null,
): SQL | undefined {
  if (storeIds === null) return undefined;
  if (storeIds.length === 0) return sql`false`;
  if (storeIds.length === 1) return eq(column, storeIds[0] as string);
  return inArray(column, [...storeIds]);
}

/** Applies common report date/currency filters to a supplied timestamp and currency column. */
function financialFilterConditions(
  filter: ReportsFinancialFilter,
  timestampColumn: AnyPgColumn,
  currencyColumn: AnyPgColumn,
): Array<SQL | undefined> {
  return [
    filter.from ? gte(timestampColumn, new Date(filter.from)) : undefined,
    filter.to ? lte(timestampColumn, new Date(filter.to)) : undefined,
    filter.currency ? eq(currencyColumn, filter.currency) : undefined,
  ];
}

/** Converts a database NUMERIC aggregate into a stable exact decimal string. */
function exactAggregate(expression: SQL): SQL<string> {
  return sql<string>`coalesce(${expression}, 0)::text`;
}

/**
 * Read/persistence boundary for Module 20 Reports.
 * Authorization, KPI definitions, finalized-status policy, export lifecycle, audit and outbox stay in the service.
 */
export class ReportsRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): ReportsRepository {
    return new ReportsRepository(executor);
  }

  /** Lists active report definitions in deterministic code order for permission filtering in the service. */
  async listActiveDefinitions(status: string): Promise<ReportDefinitionRow[]> {
    return this.executor
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.status, status))
      .orderBy(asc(reportDefinitions.code));
  }

  /** Reads one active report definition by stable report code. */
  async findActiveDefinitionByCode(
    reportCode: string,
    status: string,
  ): Promise<ReportDefinitionRow | null> {
    const [row] = await this.executor
      .select()
      .from(reportDefinitions)
      .where(and(eq(reportDefinitions.code, reportCode), eq(reportDefinitions.status, status)))
      .limit(1);
    return row ?? null;
  }

  /** Resolves the owning seller for one store so the service can reject mismatched requested scope. */
  async findStoreScope(storeId: string): Promise<ReportStoreScopeRow | null> {
    const [row] = await this.executor
      .select({ storeId: stores.id, sellerId: stores.sellerId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    return row ?? null;
  }

  /** Lists Seller Order grain Sales rows with mandatory seller/store scope enforced in SQL. */
  async listSalesRows(
    query: SalesReportQuery,
    scope: ReportsReadScope,
    includedSellerOrderStatuses: readonly string[],
  ): Promise<ReportsPage<SalesReportRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      query.sellerId ? eq(sellerOrders.sellerId, query.sellerId) : undefined,
      query.storeId ? eq(sellerOrders.storeId, query.storeId) : undefined,
      query.from ? gte(sellerOrders.createdAt, new Date(query.from)) : undefined,
      query.to ? lte(sellerOrders.createdAt, new Date(query.to)) : undefined,
      query.currency ? eq(orders.currency, query.currency) : undefined,
      includedSellerOrderStatuses.length > 0
        ? inArray(sellerOrders.status, [...includedSellerOrderStatuses])
        : sql`false`,
    ]);

    const orderBy =
      query.sort === "created_asc"
        ? [asc(sellerOrders.createdAt), asc(sellerOrders.id)]
        : query.sort === "total_desc"
          ? [desc(sellerOrders.grandTotal), desc(sellerOrders.id)]
          : query.sort === "total_asc"
            ? [asc(sellerOrders.grandTotal), asc(sellerOrders.id)]
            : [desc(sellerOrders.createdAt), desc(sellerOrders.id)];

    const items = await this.executor
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        sellerOrderId: sellerOrders.id,
        sellerOrderNo: sellerOrders.sellerOrderNo,
        sellerId: sellerOrders.sellerId,
        storeId: sellerOrders.storeId,
        orderStatus: orders.orderStatus,
        sellerOrderStatus: sellerOrders.status,
        currency: orders.currency,
        grandTotal: sellerOrders.grandTotal,
        createdAt: sellerOrders.createdAt,
      })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(where);

    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Aggregates GMV over the same finalized Seller Order population selected by the service. */
  async sumSalesGmv(
    filter: ReportsSellerFinancialFilter,
    scope: ReportsReadScope,
    includedSellerOrderStatuses: readonly string[],
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      filter.storeId ? eq(sellerOrders.storeId, filter.storeId) : undefined,
      ...financialFilterConditions(filter, sellerOrders.createdAt, orders.currency),
      includedSellerOrderStatuses.length > 0
        ? inArray(sellerOrders.status, [...includedSellerOrderStatuses])
        : sql`false`,
    ]);

    return this.executor
      .select({
        currency: orders.currency,
        amount: exactAggregate(sql`sum(${sellerOrders.grandTotal})`),
      })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(where)
      .groupBy(orders.currency)
      .orderBy(asc(orders.currency));
  }

  /** Counts distinct parent Orders and Seller Orders over the finalized Sales population. */
  async countSalesOrders(
    filter: ReportsSellerFinancialFilter,
    scope: ReportsReadScope,
    includedSellerOrderStatuses: readonly string[],
  ): Promise<{ orderCount: number; sellerOrderCount: number }> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      filter.storeId ? eq(sellerOrders.storeId, filter.storeId) : undefined,
      ...financialFilterConditions(filter, sellerOrders.createdAt, orders.currency),
      includedSellerOrderStatuses.length > 0
        ? inArray(sellerOrders.status, [...includedSellerOrderStatuses])
        : sql`false`,
    ]);
    const [row] = await this.executor
      .select({
        orderCount: sql<number>`count(distinct ${orders.id})::int`,
        sellerOrderCount: sql<number>`count(${sellerOrders.id})::int`,
      })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(where);
    return {
      orderCount: Number(row?.orderCount ?? 0),
      sellerOrderCount: Number(row?.sellerOrderCount ?? 0),
    };
  }

  /** Aggregates seller-attributable captured order value for parent Payments in service-approved captured states. */
  async sumCapturedSellerOrderValue(
    filter: ReportsSellerFinancialFilter,
    scope: ReportsReadScope,
    includedSellerOrderStatuses: readonly string[],
    capturedPaymentStatuses: readonly string[],
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      filter.storeId ? eq(sellerOrders.storeId, filter.storeId) : undefined,
      ...financialFilterConditions(filter, sellerOrders.createdAt, payments.currency),
      includedSellerOrderStatuses.length > 0
        ? inArray(sellerOrders.status, [...includedSellerOrderStatuses])
        : sql`false`,
      capturedPaymentStatuses.length > 0
        ? inArray(payments.status, [...capturedPaymentStatuses])
        : sql`false`,
    ]);

    return this.executor
      .select({
        currency: payments.currency,
        amount: exactAggregate(sql`sum(${sellerOrders.grandTotal})`),
      })
      .from(sellerOrders)
      .innerJoin(payments, eq(payments.orderId, sellerOrders.orderId))
      .where(where)
      .groupBy(payments.currency)
      .orderBy(asc(payments.currency));
  }

  /** Aggregates completed Return-linked Refund amounts with deterministic seller/store attribution. */
  async sumCompletedRefunds(
    filter: ReportsSellerFinancialFilter,
    scope: ReportsReadScope,
    completedRefundStatus: string,
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      filter.storeId ? eq(sellerOrders.storeId, filter.storeId) : undefined,
      ...financialFilterConditions(filter, refunds.updatedAt, refunds.currency),
      eq(refunds.status, completedRefundStatus),
    ]);

    return this.executor
      .select({
        currency: refunds.currency,
        amount: exactAggregate(sql`sum(${refunds.amount})`),
      })
      .from(refunds)
      .innerJoin(returnRequests, eq(returnRequests.id, refunds.returnRequestId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .groupBy(refunds.currency)
      .orderBy(asc(refunds.currency));
  }

  /** Resolves display labels for already-scoped seller IDs used by Seller Performance aggregation. */
  async listSellerDirectory(sellerIds: readonly string[]): Promise<ReportSellerDirectoryRow[]> {
    if (sellerIds.length === 0) return [];
    return this.executor
      .select({ sellerId: sellers.id, sellerName: sellers.displayName })
      .from(sellers)
      .where(inArray(sellers.id, [...sellerIds]))
      .orderBy(asc(sellers.id));
  }

  /** Lists seller/currency GMV aggregates; the service supplies the finalized Seller Order status policy. */
  async listSellerSalesAggregates(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    includedSellerOrderStatuses: readonly string[],
  ): Promise<SellerSalesAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, sellerOrders.createdAt, orders.currency),
      includedSellerOrderStatuses.length > 0
        ? inArray(sellerOrders.status, [...includedSellerOrderStatuses])
        : sql`false`,
    ]);

    return this.executor
      .select({
        sellerId: sellers.id,
        sellerName: sellers.displayName,
        currency: orders.currency,
        orderCount: sql<number>`count(distinct ${sellerOrders.id})::int`,
        gmv: exactAggregate(sql`sum(${sellerOrders.grandTotal})`),
      })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .innerJoin(sellers, eq(sellers.id, sellerOrders.sellerId))
      .where(where)
      .groupBy(sellers.id, sellers.displayName, orders.currency)
      .orderBy(asc(sellers.id), asc(orders.currency));
  }

  /** Aggregates signed Commission ledger values per seller/currency without deciding which entry types count as revenue. */
  async listSellerCommissionAggregates(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    includedEntryTypes: readonly string[],
  ): Promise<SellerCommissionAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(commissionEntries.sellerId, scope.sellerIds),
      filter.sellerId ? eq(commissionEntries.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, commissionEntries.occurredAt, commissionEntries.currency),
      includedEntryTypes.length > 0
        ? inArray(commissionEntries.type, [...includedEntryTypes])
        : sql`false`,
    ]);

    return this.executor
      .select({
        sellerId: commissionEntries.sellerId,
        currency: commissionEntries.currency,
        commissionRevenue: exactAggregate(sql`sum(${commissionEntries.commissionAmount})`),
      })
      .from(commissionEntries)
      .where(where)
      .groupBy(commissionEntries.sellerId, commissionEntries.currency)
      .orderBy(asc(commissionEntries.sellerId), asc(commissionEntries.currency));
  }

  /** Reconstructs seller payable by summing signed immutable Wallet bucket deltas through the requested end date. */
  async listSellerWalletAggregates(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    payableBuckets: readonly string[],
    negativeBucket: string,
  ): Promise<SellerWalletAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerWalletEntries.sellerId, scope.sellerIds),
      filter.sellerId ? eq(sellerWalletEntries.sellerId, filter.sellerId) : undefined,
      filter.to ? lte(sellerWalletEntries.occurredAt, new Date(filter.to)) : undefined,
      filter.currency ? eq(sellerWalletEntries.currency, filter.currency) : undefined,
      inArray(sellerWalletEntries.balanceBucket, [...payableBuckets, negativeBucket]),
    ]);

    return this.executor
      .select({
        sellerId: sellerWalletEntries.sellerId,
        currency: sellerWalletEntries.currency,
        sellerPayable: exactAggregate(sql`sum(${sellerWalletEntries.amount})`),
      })
      .from(sellerWalletEntries)
      .where(where)
      .groupBy(sellerWalletEntries.sellerId, sellerWalletEntries.currency)
      .orderBy(asc(sellerWalletEntries.sellerId), asc(sellerWalletEntries.currency));
  }

  /** Aggregates completed Return-linked Refunds per seller/currency for Seller Performance. */
  async listSellerRefundAggregates(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    completedRefundStatus: string,
  ): Promise<SellerRefundAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      filter.sellerId ? eq(sellerOrders.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, refunds.updatedAt, refunds.currency),
      eq(refunds.status, completedRefundStatus),
    ]);

    return this.executor
      .select({
        sellerId: sellerOrders.sellerId,
        currency: refunds.currency,
        refunds: exactAggregate(sql`sum(${refunds.amount})`),
      })
      .from(refunds)
      .innerJoin(returnRequests, eq(returnRequests.id, refunds.returnRequestId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .groupBy(sellerOrders.sellerId, refunds.currency)
      .orderBy(asc(sellerOrders.sellerId), asc(refunds.currency));
  }

  /** Aggregates only service-approved terminal paid Payouts per seller/currency. */
  async listSellerPayoutAggregates(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    paidStatus: string,
  ): Promise<SellerPayoutAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(payouts.sellerId, scope.sellerIds),
      filter.sellerId ? eq(payouts.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, payouts.requestedAt, payouts.currency),
      eq(payouts.status, paidStatus),
    ]);

    return this.executor
      .select({
        sellerId: payouts.sellerId,
        currency: payouts.currency,
        payouts: exactAggregate(sql`sum(${payouts.amount})`),
      })
      .from(payouts)
      .where(where)
      .groupBy(payouts.sellerId, payouts.currency)
      .orderBy(asc(payouts.sellerId), asc(payouts.currency));
  }

  /** Lists current Inventory state with low-stock evaluation performed directly from authoritative quantities. */
  async listInventoryRows(
    query: InventoryReportQuery,
    scope: ReportsReadScope,
  ): Promise<ReportsPage<InventoryReportRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const lowStockCondition = sql`${inventoryItems.reorderLevel} is not null
      and (${inventoryItems.onHandQty} - ${inventoryItems.reservedQty}) <= ${inventoryItems.reorderLevel}`;
    const where = combineConditions([
      sellerScopeCondition(inventoryItems.sellerId, scope.sellerIds),
      storeScopeCondition(inventoryItems.storeId, scope.storeIds),
      query.sellerId ? eq(inventoryItems.sellerId, query.sellerId) : undefined,
      query.storeId ? eq(inventoryItems.storeId, query.storeId) : undefined,
      query.lowStockOnly ? lowStockCondition : undefined,
    ]);
    const available = sql<number>`(${inventoryItems.onHandQty} - ${inventoryItems.reservedQty})`;
    const orderBy =
      query.sort === "available_desc"
        ? [desc(available), desc(inventoryItems.id)]
        : query.sort === "updated_desc"
          ? [desc(inventoryItems.updatedAt), desc(inventoryItems.id)]
          : query.sort === "updated_asc"
            ? [asc(inventoryItems.updatedAt), asc(inventoryItems.id)]
            : [asc(available), asc(inventoryItems.id)];

    const items = await this.executor
      .select({
        inventoryItemId: inventoryItems.id,
        sellerId: inventoryItems.sellerId,
        storeId: inventoryItems.storeId,
        variantId: inventoryItems.variantId,
        sku: productVariants.sku,
        onHandQty: inventoryItems.onHandQty,
        reservedQty: inventoryItems.reservedQty,
        availableQty: available,
        reorderLevel: inventoryItems.reorderLevel,
        lowStock: sql<boolean>`${lowStockCondition}`,
        updatedAt: inventoryItems.updatedAt,
      })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(inventoryItems)
      .where(where);

    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Lists completed Return-linked Refund rows with seller/store scope enforced in SQL. */
  async listRefundRows(
    query: RefundsReportQuery,
    scope: ReportsReadScope,
    includedStatuses: readonly string[],
  ): Promise<ReportsPage<RefundReportRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      query.sellerId ? eq(sellerOrders.sellerId, query.sellerId) : undefined,
      query.storeId ? eq(sellerOrders.storeId, query.storeId) : undefined,
      ...financialFilterConditions(query, refunds.createdAt, refunds.currency),
      includedStatuses.length > 0 ? inArray(refunds.status, [...includedStatuses]) : sql`false`,
    ]);
    const orderBy =
      query.sort === "created_asc"
        ? [asc(refunds.createdAt), asc(refunds.id)]
        : query.sort === "amount_desc"
          ? [desc(refunds.amount), desc(refunds.id)]
          : query.sort === "amount_asc"
            ? [asc(refunds.amount), asc(refunds.id)]
            : [desc(refunds.createdAt), desc(refunds.id)];

    const items = await this.executor
      .select({
        refundId: refunds.id,
        returnRequestId: refunds.returnRequestId,
        orderId: refunds.orderId,
        sellerId: sellerOrders.sellerId,
        storeId: sellerOrders.storeId,
        status: refunds.status,
        currency: refunds.currency,
        amount: refunds.amount,
        createdAt: refunds.createdAt,
        updatedAt: refunds.updatedAt,
      })
      .from(refunds)
      .innerJoin(returnRequests, eq(returnRequests.id, refunds.returnRequestId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(refunds)
      .innerJoin(returnRequests, eq(returnRequests.id, refunds.returnRequestId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where);

    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Lists immutable Commission ledger rows with seller scope enforced directly in SQL. */
  async listCommissionRows(
    query: CommissionsReportQuery,
    scope: ReportsReadScope,
    includedEntryTypes: readonly string[],
  ): Promise<ReportsPage<CommissionReportRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(commissionEntries.sellerId, scope.sellerIds),
      query.sellerId ? eq(commissionEntries.sellerId, query.sellerId) : undefined,
      ...financialFilterConditions(query, commissionEntries.occurredAt, commissionEntries.currency),
      includedEntryTypes.length > 0
        ? inArray(commissionEntries.type, [...includedEntryTypes])
        : sql`false`,
    ]);
    const orderBy =
      query.sort === "occurred_asc"
        ? [asc(commissionEntries.occurredAt), asc(commissionEntries.id)]
        : query.sort === "amount_desc"
          ? [desc(commissionEntries.commissionAmount), desc(commissionEntries.id)]
          : query.sort === "amount_asc"
            ? [asc(commissionEntries.commissionAmount), asc(commissionEntries.id)]
            : [desc(commissionEntries.occurredAt), desc(commissionEntries.id)];

    const items = await this.executor
      .select({
        commissionEntryId: commissionEntries.id,
        sellerId: commissionEntries.sellerId,
        sellerOrderId: commissionEntries.sellerOrderId,
        orderItemId: commissionEntries.orderItemId,
        entryType: commissionEntries.type,
        currency: commissionEntries.currency,
        grossAmount: commissionEntries.grossAmount,
        commissionAmount: commissionEntries.commissionAmount,
        sellerNetAmount: commissionEntries.sellerNetAmount,
        occurredAt: commissionEntries.occurredAt,
      })
      .from(commissionEntries)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(commissionEntries)
      .where(where);
    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Sums signed Commission revenue by currency over the exact filtered immutable ledger population. */
  async sumCommissionRevenue(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    includedEntryTypes: readonly string[],
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(commissionEntries.sellerId, scope.sellerIds),
      filter.sellerId ? eq(commissionEntries.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, commissionEntries.occurredAt, commissionEntries.currency),
      includedEntryTypes.length > 0
        ? inArray(commissionEntries.type, [...includedEntryTypes])
        : sql`false`,
    ]);
    return this.executor
      .select({
        currency: commissionEntries.currency,
        amount: exactAggregate(sql`sum(${commissionEntries.commissionAmount})`),
      })
      .from(commissionEntries)
      .where(where)
      .groupBy(commissionEntries.currency)
      .orderBy(asc(commissionEntries.currency));
  }

  /** Lists Payout rows with seller scope enforced directly in SQL. */
  async listPayoutRows(
    query: PayoutsReportQuery,
    scope: ReportsReadScope,
    includedStatuses: readonly string[],
  ): Promise<ReportsPage<PayoutReportRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(payouts.sellerId, scope.sellerIds),
      query.sellerId ? eq(payouts.sellerId, query.sellerId) : undefined,
      ...financialFilterConditions(query, payouts.requestedAt, payouts.currency),
      includedStatuses.length > 0 ? inArray(payouts.status, [...includedStatuses]) : sql`false`,
    ]);
    const orderBy =
      query.sort === "requested_asc"
        ? [asc(payouts.requestedAt), asc(payouts.id)]
        : query.sort === "amount_desc"
          ? [desc(payouts.amount), desc(payouts.id)]
          : query.sort === "amount_asc"
            ? [asc(payouts.amount), asc(payouts.id)]
            : [desc(payouts.requestedAt), desc(payouts.id)];

    const items = await this.executor
      .select({
        payoutId: payouts.id,
        payoutNo: payouts.payoutNo,
        sellerId: payouts.sellerId,
        status: payouts.status,
        currency: payouts.currency,
        amount: payouts.amount,
        requestedAt: payouts.requestedAt,
        processedAt: payouts.processedAt,
      })
      .from(payouts)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(payouts)
      .where(where);
    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Reconstructs seller payable by currency from signed immutable Wallet deltas through the requested end date. */
  async sumSellerPayable(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    payableBuckets: readonly string[],
    negativeBucket: string,
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(sellerWalletEntries.sellerId, scope.sellerIds),
      filter.sellerId ? eq(sellerWalletEntries.sellerId, filter.sellerId) : undefined,
      filter.to ? lte(sellerWalletEntries.occurredAt, new Date(filter.to)) : undefined,
      filter.currency ? eq(sellerWalletEntries.currency, filter.currency) : undefined,
      inArray(sellerWalletEntries.balanceBucket, [...payableBuckets, negativeBucket]),
    ]);
    return this.executor
      .select({
        currency: sellerWalletEntries.currency,
        amount: exactAggregate(sql`sum(${sellerWalletEntries.amount})`),
      })
      .from(sellerWalletEntries)
      .where(where)
      .groupBy(sellerWalletEntries.currency)
      .orderBy(asc(sellerWalletEntries.currency));
  }

  /** Sums only terminal paid Payouts by currency so requested/failed amounts never become paid-out totals. */
  async sumPaidPayouts(
    filter: ReportsFinancialFilter & { sellerId?: string | undefined },
    scope: ReportsReadScope,
    paidStatus: string,
  ): Promise<CurrencyAggregateRow[]> {
    const where = combineConditions([
      sellerScopeCondition(payouts.sellerId, scope.sellerIds),
      filter.sellerId ? eq(payouts.sellerId, filter.sellerId) : undefined,
      ...financialFilterConditions(filter, payouts.requestedAt, payouts.currency),
      eq(payouts.status, paidStatus),
    ]);
    return this.executor
      .select({
        currency: payouts.currency,
        amount: exactAggregate(sql`sum(${payouts.amount})`),
      })
      .from(payouts)
      .where(where)
      .groupBy(payouts.currency)
      .orderBy(asc(payouts.currency));
  }

  /** Lists seller-safe audit rows for the approved asynchronous audit export. */
  async listAuditExportRows(
    filter: {
      actorUserId?: string | undefined;
      action?: string | undefined;
      resourceType?: string | undefined;
      resourceId?: string | undefined;
      sellerId?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
    },
    scope: ReportsReadScope,
  ): Promise<AuditExportRecord[]> {
    const where = combineConditions([
      sellerScopeCondition(auditLogs.sellerId, scope.sellerIds),
      filter.actorUserId ? eq(auditLogs.actorUserId, filter.actorUserId) : undefined,
      filter.action ? eq(auditLogs.action, filter.action) : undefined,
      filter.resourceType ? eq(auditLogs.resourceType, filter.resourceType) : undefined,
      filter.resourceId ? eq(auditLogs.resourceId, filter.resourceId) : undefined,
      filter.sellerId ? eq(auditLogs.sellerId, filter.sellerId) : undefined,
      filter.from ? gte(auditLogs.createdAt, new Date(filter.from)) : undefined,
      filter.to ? lte(auditLogs.createdAt, new Date(filter.to)) : undefined,
    ]);

    return this.executor
      .select({
        id: auditLogs.id,
        actorUserId: auditLogs.actorUserId,
        actorType: auditLogs.actorType,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        sellerId: auditLogs.sellerId,
        requestId: auditLogs.requestId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(where)
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
  }

  /** Inserts one queued asynchronous report run after service authorization and filter validation succeed. */
  async createReportRun(input: CreateReportRunRecordInput): Promise<ReportRunRow> {
    const [row] = await this.executor
      .insert(reportRuns)
      .values({
        reportCode: input.reportCode,
        requestedBy: input.requestedBy,
        filtersJson: input.filtersJson,
        outputFormat: input.outputFormat,
        status: "queued",
      })
      .returning();
    if (!row) throw new Error("Report run insert completed without returning a row.");
    return row;
  }

  /** Lists one bounded page of export runs owned by the authenticated requester. */
  async listReportRunsByRequester(
    requestedBy: string,
    query: ReportRunListQuery,
  ): Promise<ReportsPage<ReportRunRow>> {
    const { limit, offset } = toLimitOffset(query);
    const where = eq(reportRuns.requestedBy, requestedBy);
    const items = await this.executor
      .select()
      .from(reportRuns)
      .where(where)
      .orderBy(desc(reportRuns.createdAt), desc(reportRuns.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(reportRuns)
      .where(where);
    return { items, totalItems: Number(totalRow?.value ?? 0) };
  }

  /** Reads one report run without applying requester authorization; the service owns that policy. */
  async findReportRunById(reportRunId: string): Promise<ReportRunRow | null> {
    const [row] = await this.executor
      .select()
      .from(reportRuns)
      .where(eq(reportRuns.id, reportRunId))
      .limit(1);
    return row ?? null;
  }

  /** Marks one queued run processing exactly once and returns the updated row. */
  async markReportRunProcessing(reportRunId: string, startedAt: Date): Promise<ReportRunRow | null> {
    const [row] = await this.executor
      .update(reportRuns)
      .set({ status: "processing", startedAt, errorCode: null })
      .where(and(eq(reportRuns.id, reportRunId), eq(reportRuns.status, "queued")))
      .returning();
    return row ?? null;
  }

  /** Marks one processing run completed and stores the generated Module 21 file reference. */
  async markReportRunCompleted(
    reportRunId: string,
    fileId: string,
    finishedAt: Date,
  ): Promise<ReportRunRow | null> {
    const [row] = await this.executor
      .update(reportRuns)
      .set({ status: "completed", fileId, finishedAt, errorCode: null })
      .where(and(eq(reportRuns.id, reportRunId), eq(reportRuns.status, "processing")))
      .returning();
    return row ?? null;
  }

  /** Marks one queued/processing run failed with a stable safe error code. */
  async markReportRunFailed(
    reportRunId: string,
    errorCode: string,
    finishedAt: Date,
  ): Promise<ReportRunRow | null> {
    const [row] = await this.executor
      .update(reportRuns)
      .set({ status: "failed", finishedAt, errorCode })
      .where(
        and(
          eq(reportRuns.id, reportRunId),
          inArray(reportRuns.status, ["queued", "processing"]),
        ),
      )
      .returning();
    return row ?? null;
  }
}
