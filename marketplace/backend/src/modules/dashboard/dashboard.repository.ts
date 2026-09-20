import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../../database/db.js";
import {
  dashboardPreferences,
  dashboardSavedFilters,
  type DashboardPreferenceRow,
  type DashboardSavedFilterRow,
  type NewDashboardSavedFilterRow,
} from "../../database/schema/dashboard.js";
import { inventoryItems } from "../../database/schema/inventory.js";
import { sellerOrders } from "../../database/schema/orders.js";
import { products, productVariants } from "../../database/schema/products.js";
import { returnRequests } from "../../database/schema/returns-refunds.js";
import { payouts } from "../../database/schema/seller-wallet-payouts.js";
import { stores } from "../../database/schema/sellers.js";
import { shipments } from "../../database/schema/shipping.js";
import type { DatabaseExecutor } from "../../database/types.js";
import type { DashboardFilter } from "./dashboard.schema.js";

/** Mandatory seller/store scope resolved by the Dashboard service before repository reads. */
export interface DashboardReadScope {
  sellerIds: readonly string[] | null;
  storeIds: readonly string[] | null;
}

/** Current Inventory filters the repository can apply without inventing historical category data. */
export type DashboardInventoryReadFilter = Pick<
  DashboardFilter,
  "sellerId" | "storeId" | "categoryId"
>;

/** Seller/store/date filters supported by fulfillment and Return source reads. */
export type DashboardSellerStoreDateReadFilter = Pick<
  DashboardFilter,
  "sellerId" | "storeId" | "from" | "to"
>;

/** Seller/date filters supported by seller-level Payout source reads. */
export type DashboardSellerDateReadFilter = Pick<
  DashboardFilter,
  "sellerId" | "from" | "to"
>;


/** One store ownership row used by the service to validate requested resource scope. */
export interface DashboardStoreScopeRow {
  storeId: string;
  sellerId: string;
}

/** Complete persisted preference values supplied after service-side validation/default resolution. */
export interface DashboardPreferenceWriteInput {
  layoutJson: Record<string, unknown>;
  defaultDateRange: string;
  defaultStoreId: string | null;
}

/** One validated user-owned saved filter ready for persistence. */
export interface DashboardSavedFilterWriteInput {
  name: string;
  filterJson: Record<string, unknown>;
}

/** One current low-stock source row projected for the Dashboard alert layer. */
export interface DashboardLowStockSourceRow {
  inventoryItemId: string;
  sellerId: string;
  storeId: string;
  variantId: string;
  sku: string;
  availableQty: number;
  reorderLevel: number;
  updatedAt: Date;
}

/** One seller-order shipment requiring fulfillment attention. */
export interface DashboardFulfillmentSourceRow {
  sellerOrderId: string;
  sellerId: string;
  storeId: string;
  sellerOrderNo: string;
  status: string;
  shipmentId: string | null;
  shipmentStatus: string | null;
  occurredAt: Date;
}

/** One Return request requiring seller/support attention. */
export interface DashboardReturnSourceRow {
  returnRequestId: string;
  returnNo: string;
  sellerId: string;
  storeId: string;
  status: string;
  occurredAt: Date;
}

/** One seller-level Payout requiring finance attention. */
export interface DashboardPayoutSourceRow {
  payoutId: string;
  payoutNo: string;
  sellerId: string;
  status: string;
  currency: string;
  amount: string;
  occurredAt: Date;
}

/** Combines optional SQL predicates while keeping repository methods readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length > 0 ? and(...active) : undefined;
}

/** Converts an already-authorized seller scope into a mandatory SQL predicate. */
function sellerScopeCondition(
  column: AnyPgColumn,
  sellerIds: readonly string[] | null,
): SQL | undefined {
  if (sellerIds === null) return undefined;
  if (sellerIds.length === 0) return sql`false`;
  if (sellerIds.length === 1) return eq(column, sellerIds[0] as string);
  return inArray(column, [...sellerIds]);
}

/** Converts an already-authorized store scope into a mandatory SQL predicate. */
function storeScopeCondition(
  column: AnyPgColumn,
  storeIds: readonly string[] | null,
): SQL | undefined {
  if (storeIds === null) return undefined;
  if (storeIds.length === 0) return sql`false`;
  if (storeIds.length === 1) return eq(column, storeIds[0] as string);
  return inArray(column, [...storeIds]);
}

/** Applies optional seller/store filters only after mandatory actor scope has already been added. */
function requestedSellerStoreConditions(
  filter: Pick<DashboardFilter, "sellerId" | "storeId">,
  sellerColumn: AnyPgColumn,
  storeColumn: AnyPgColumn,
): Array<SQL | undefined> {
  return [
    filter.sellerId ? eq(sellerColumn, filter.sellerId) : undefined,
    filter.storeId ? eq(storeColumn, filter.storeId) : undefined,
  ];
}

/** Applies an optional Dashboard date window to one authoritative source timestamp. */
function dateConditions(
  filter: Pick<DashboardFilter, "from" | "to">,
  timestampColumn: AnyPgColumn,
): Array<SQL | undefined> {
  return [
    filter.from ? gte(timestampColumn, new Date(filter.from)) : undefined,
    filter.to ? lte(timestampColumn, new Date(filter.to)) : undefined,
  ];
}

/** Read/persistence boundary for Module 1 Dashboard-owned preferences and operational source summaries. */
export class DashboardRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to an existing transaction so multi-write preference changes stay atomic. */
  using(executor: DatabaseExecutor): DashboardRepository {
    return new DashboardRepository(executor);
  }

  /** Resolves one store's owning seller so the service can reject mismatched or foreign scope. */
  async findStoreScope(storeId: string): Promise<DashboardStoreScopeRow | null> {
    const [row] = await this.executor
      .select({ storeId: stores.id, sellerId: stores.sellerId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    return row ?? null;
  }

  /** Reads the authenticated user's Dashboard preference row without applying application defaults. */
  async findPreferencesByUserId(userId: string): Promise<DashboardPreferenceRow | null> {
    const [row] = await this.executor
      .select()
      .from(dashboardPreferences)
      .where(eq(dashboardPreferences.userId, userId))
      .limit(1);
    return row ?? null;
  }

  /** Lists only the authenticated user's saved Dashboard filters in deterministic creation order. */
  async listSavedFiltersByUserId(userId: string): Promise<DashboardSavedFilterRow[]> {
    return this.executor
      .select()
      .from(dashboardSavedFilters)
      .where(eq(dashboardSavedFilters.userId, userId))
      .orderBy(asc(dashboardSavedFilters.createdAt), asc(dashboardSavedFilters.id));
  }

  /** Creates or replaces one user's complete Dashboard preference snapshot. */
  async upsertPreferences(
    userId: string,
    input: DashboardPreferenceWriteInput,
    updatedAt = new Date(),
  ): Promise<DashboardPreferenceRow> {
    const [row] = await this.executor
      .insert(dashboardPreferences)
      .values({
        userId,
        layoutJson: input.layoutJson,
        defaultDateRange: input.defaultDateRange,
        defaultStoreId: input.defaultStoreId,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: dashboardPreferences.userId,
        set: {
          layoutJson: input.layoutJson,
          defaultDateRange: input.defaultDateRange,
          defaultStoreId: input.defaultStoreId,
          updatedAt,
        },
      })
      .returning();

    if (!row) throw new Error("Dashboard preference upsert completed without returning a row.");
    return row;
  }

  /** Replaces one user's saved filters; callers should bind a transaction when combined with preference updates. */
  async replaceSavedFilters(
    userId: string,
    inputs: readonly DashboardSavedFilterWriteInput[],
    createdAt = new Date(),
  ): Promise<DashboardSavedFilterRow[]> {
    await this.executor.delete(dashboardSavedFilters).where(eq(dashboardSavedFilters.userId, userId));

    if (inputs.length > 0) {
      const values: NewDashboardSavedFilterRow[] = inputs.map((input) => ({
        userId,
        name: input.name,
        filterJson: input.filterJson,
        createdAt,
      }));
      await this.executor.insert(dashboardSavedFilters).values(values);
    }

    return this.listSavedFiltersByUserId(userId);
  }

  /** Counts current low-stock variants inside mandatory seller/store scope and optional current category scope. */
  async countLowStockVariants(
    filter: DashboardInventoryReadFilter,
    scope: DashboardReadScope,
  ): Promise<number> {
    const lowStockCondition = sql`${inventoryItems.reorderLevel} is not null
      and (${inventoryItems.onHandQty} - ${inventoryItems.reservedQty}) <= ${inventoryItems.reorderLevel}`;
    const where = combineConditions([
      sellerScopeCondition(inventoryItems.sellerId, scope.sellerIds),
      storeScopeCondition(inventoryItems.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, inventoryItems.sellerId, inventoryItems.storeId),
      filter.categoryId ? eq(products.categoryId, filter.categoryId) : undefined,
      lowStockCondition,
    ]);
    const [row] = await this.executor
      .select({ value: count() })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where);
    return Number(row?.value ?? 0);
  }

  /** Counts Return requests in service-approved open states with mandatory seller/store scope applied in SQL. */
  async countOpenReturns(
    filter: DashboardSellerStoreDateReadFilter,
    scope: DashboardReadScope,
    openStatuses: readonly string[],
  ): Promise<number> {
    if (openStatuses.length === 0) return 0;
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, sellerOrders.sellerId, sellerOrders.storeId),
      ...dateConditions(filter, returnRequests.requestedAt),
      inArray(returnRequests.status, [...openStatuses]),
    ]);
    const [row] = await this.executor
      .select({ value: count() })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where);
    return Number(row?.value ?? 0);
  }

  /** Lists current low-stock rows for Dashboard alerts without mutating authoritative Inventory state. */
  async listLowStockSources(
    filter: DashboardInventoryReadFilter,
    scope: DashboardReadScope,
    limit: number,
  ): Promise<DashboardLowStockSourceRow[]> {
    const availableQty = sql<number>`${inventoryItems.onHandQty} - ${inventoryItems.reservedQty}`;
    const lowStockCondition = sql`${inventoryItems.reorderLevel} is not null
      and (${inventoryItems.onHandQty} - ${inventoryItems.reservedQty}) <= ${inventoryItems.reorderLevel}`;
    const where = combineConditions([
      sellerScopeCondition(inventoryItems.sellerId, scope.sellerIds),
      storeScopeCondition(inventoryItems.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, inventoryItems.sellerId, inventoryItems.storeId),
      filter.categoryId ? eq(products.categoryId, filter.categoryId) : undefined,
      lowStockCondition,
    ]);

    return this.executor
      .select({
        inventoryItemId: inventoryItems.id,
        sellerId: inventoryItems.sellerId,
        storeId: inventoryItems.storeId,
        variantId: inventoryItems.variantId,
        sku: productVariants.sku,
        availableQty,
        reorderLevel: sql<number>`${inventoryItems.reorderLevel}::int`,
        updatedAt: inventoryItems.updatedAt,
      })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(asc(availableQty), desc(inventoryItems.updatedAt), asc(inventoryItems.id))
      .limit(limit);
  }

  /** Counts fulfillment-attention rows using the same scoped source policy as the alert list. */
  async countFulfillmentSources(
    filter: DashboardSellerStoreDateReadFilter,
    scope: DashboardReadScope,
    sellerOrderStatuses: readonly string[],
    shipmentStatuses: readonly string[],
  ): Promise<number> {
    if (sellerOrderStatuses.length === 0 && shipmentStatuses.length === 0) return 0;

    const attentionCondition =
      sellerOrderStatuses.length > 0 && shipmentStatuses.length > 0
        ? or(
            inArray(sellerOrders.status, [...sellerOrderStatuses]),
            inArray(shipments.status, [...shipmentStatuses]),
          )
        : sellerOrderStatuses.length > 0
          ? inArray(sellerOrders.status, [...sellerOrderStatuses])
          : inArray(shipments.status, [...shipmentStatuses]);
    const occurredAt = sql<Date>`coalesce(${shipments.updatedAt}, ${sellerOrders.updatedAt})`;
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, sellerOrders.sellerId, sellerOrders.storeId),
      filter.from ? sql`${occurredAt} >= ${new Date(filter.from)}` : undefined,
      filter.to ? sql`${occurredAt} <= ${new Date(filter.to)}` : undefined,
      attentionCondition,
    ]);
    const [row] = await this.executor
      .select({ value: count() })
      .from(sellerOrders)
      .leftJoin(shipments, eq(shipments.sellerOrderId, sellerOrders.id))
      .where(where);
    return Number(row?.value ?? 0);
  }

  /** Lists seller orders/shipments in service-approved attention states with mandatory seller/store scope. */
  async listFulfillmentSources(
    filter: DashboardSellerStoreDateReadFilter,
    scope: DashboardReadScope,
    sellerOrderStatuses: readonly string[],
    shipmentStatuses: readonly string[],
    limit: number,
  ): Promise<DashboardFulfillmentSourceRow[]> {
    if (sellerOrderStatuses.length === 0 && shipmentStatuses.length === 0) return [];

    const attentionCondition =
      sellerOrderStatuses.length > 0 && shipmentStatuses.length > 0
        ? or(
            inArray(sellerOrders.status, [...sellerOrderStatuses]),
            inArray(shipments.status, [...shipmentStatuses]),
          )
        : sellerOrderStatuses.length > 0
          ? inArray(sellerOrders.status, [...sellerOrderStatuses])
          : inArray(shipments.status, [...shipmentStatuses]);
    const occurredAt = sql<Date>`coalesce(${shipments.updatedAt}, ${sellerOrders.updatedAt})`;
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, sellerOrders.sellerId, sellerOrders.storeId),
      filter.from ? sql`${occurredAt} >= ${new Date(filter.from)}` : undefined,
      filter.to ? sql`${occurredAt} <= ${new Date(filter.to)}` : undefined,
      attentionCondition,
    ]);

    return this.executor
      .select({
        sellerOrderId: sellerOrders.id,
        sellerId: sellerOrders.sellerId,
        storeId: sellerOrders.storeId,
        sellerOrderNo: sellerOrders.sellerOrderNo,
        status: sellerOrders.status,
        shipmentId: shipments.id,
        shipmentStatus: shipments.status,
        occurredAt,
      })
      .from(sellerOrders)
      .leftJoin(shipments, eq(shipments.sellerOrderId, sellerOrders.id))
      .where(where)
      .orderBy(desc(occurredAt), asc(sellerOrders.id))
      .limit(limit);
  }

  /** Lists Return requests in service-approved attention states with mandatory seller/store scope. */
  async listReturnSources(
    filter: DashboardSellerStoreDateReadFilter,
    scope: DashboardReadScope,
    statuses: readonly string[],
    limit: number,
  ): Promise<DashboardReturnSourceRow[]> {
    if (statuses.length === 0) return [];
    const where = combineConditions([
      sellerScopeCondition(sellerOrders.sellerId, scope.sellerIds),
      storeScopeCondition(sellerOrders.storeId, scope.storeIds),
      ...requestedSellerStoreConditions(filter, sellerOrders.sellerId, sellerOrders.storeId),
      ...dateConditions(filter, returnRequests.requestedAt),
      inArray(returnRequests.status, [...statuses]),
    ]);

    return this.executor
      .select({
        returnRequestId: returnRequests.id,
        returnNo: returnRequests.returnNo,
        sellerId: sellerOrders.sellerId,
        storeId: sellerOrders.storeId,
        status: returnRequests.status,
        occurredAt: returnRequests.requestedAt,
      })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .orderBy(desc(returnRequests.requestedAt), asc(returnRequests.id))
      .limit(limit);
  }

  /** Counts seller-level Payout attention rows without pretending a store-level ledger grain exists. */
  async countPayoutSources(
    filter: DashboardSellerDateReadFilter,
    scope: DashboardReadScope,
    statuses: readonly string[],
  ): Promise<number> {
    if (statuses.length === 0) return 0;
    const where = combineConditions([
      sellerScopeCondition(payouts.sellerId, scope.sellerIds),
      filter.sellerId ? eq(payouts.sellerId, filter.sellerId) : undefined,
      ...dateConditions(filter, payouts.requestedAt),
      inArray(payouts.status, [...statuses]),
    ]);
    const [row] = await this.executor
      .select({ value: count() })
      .from(payouts)
      .where(where);
    return Number(row?.value ?? 0);
  }

  /** Lists seller-level Payouts; store/category filters are intentionally not accepted at this ledger grain. */
  async listPayoutSources(
    filter: DashboardSellerDateReadFilter,
    scope: DashboardReadScope,
    statuses: readonly string[],
    limit: number,
  ): Promise<DashboardPayoutSourceRow[]> {
    if (statuses.length === 0) return [];
    const where = combineConditions([
      sellerScopeCondition(payouts.sellerId, scope.sellerIds),
      filter.sellerId ? eq(payouts.sellerId, filter.sellerId) : undefined,
      ...dateConditions(filter, payouts.requestedAt),
      inArray(payouts.status, [...statuses]),
    ]);

    return this.executor
      .select({
        payoutId: payouts.id,
        payoutNo: payouts.payoutNo,
        sellerId: payouts.sellerId,
        status: payouts.status,
        currency: payouts.currency,
        amount: payouts.amount,
        occurredAt: payouts.requestedAt,
      })
      .from(payouts)
      .where(where)
      .orderBy(desc(payouts.requestedAt), asc(payouts.id))
      .limit(limit);
  }
}
