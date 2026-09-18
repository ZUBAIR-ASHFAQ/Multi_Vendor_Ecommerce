import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import { sellerOrders } from "../../database/schema/orders.js";
import {
  refunds,
  returnItems,
  returnRequests,
  returnStatusHistory,
  type NewRefundRow,
  type NewReturnItemRow,
  type NewReturnRequestRow,
  type NewReturnStatusHistoryRow,
  type RefundRow,
  type ReturnItemRow,
  type ReturnRequestRow,
  type ReturnStatusHistoryRow,
} from "../../database/schema/returns-refunds.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { RETURN_REQUEST_STATUS } from "./returns-refunds.constants.js";
import type {
  AdminReturnListQuery,
  CustomerReturnListQuery,
  ReturnItemCondition,
  ReturnItemResolution,
  ReturnReasonCode,
  ReturnRequestStatus,
  SellerReturnListQuery,
} from "./returns-refunds.schema.js";

/** Server-derived seller/store identities that constrain every private seller Return query. */
export interface ReturnSellerScope {
  sellerIds: string[];
  storeIds: string[];
}

/** One bounded page of Return Request headers before the service attaches child records. */
export interface PaginatedReturnRequestRows {
  items: ReturnRequestRow[];
  totalItems: number;
}

/** Return Request fields already validated and decided by the Module 14 service. */
export interface CreateReturnRequestRecordInput {
  id?: string;
  returnNo: string;
  orderId: string;
  sellerOrderId: string;
  customerUserId: string;
  status: ReturnRequestStatus;
  reasonCode: ReturnReasonCode;
  requestedAt?: Date;
  approvedAt?: Date | null;
}

/** Immutable requested quantity already validated by the Module 14 service. */
export interface CreateReturnItemRecordInput {
  id?: string;
  orderItemId: string;
  quantity: number;
}

/** Service-approved Return Request lifecycle fields persisted without deciding transitions here. */
export interface UpdateReturnRequestStatusRecordInput {
  status: ReturnRequestStatus;
  approvedAt?: Date | null;
}

/** Service-approved item resolution; condition stays null when policy allows refund without a physical return. */
export interface UpdateReturnItemResolutionRecordInput {
  itemCondition: ReturnItemCondition | null;
  resolution: ReturnItemResolution;
  restockQty: number;
}

/** Financial outcome written only after the service has completed the authoritative refund orchestration. */
export interface UpdateReturnItemRefundRecordInput {
  refundAmount: string;
}

/** One append-only Return lifecycle record already approved by the service state machine. */
export interface CreateReturnStatusHistoryRecordInput {
  fromStatus: ReturnRequestStatus | null;
  toStatus: ReturnRequestStatus;
  changedBy: string | null;
  reason?: string | null;
  changedAt?: Date;
}

/** Business Refund fields already calculated and authorized by the Module 14 service. */
export interface CreateRefundRecordInput {
  id?: string;
  returnRequestId: string | null;
  orderId: string;
  paymentId: string;
  amount: string;
  currency: string;
  status: string;
  providerRef?: string | null;
  idempotencyKey: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Provider-authoritative Refund result fields persisted after the Payment boundary returns. */
export interface UpdateRefundResultRecordInput {
  status: string;
  providerRef?: string | null;
  updatedAt?: Date;
}

/** Persisted Return quantity already reserved against one immutable Order Item. */
export interface ReturnQuantityReservationRow {
  orderItemId: string;
  reservedQuantity: number;
}

/** Persisted per-Order-Item Return history used later for cumulative exact refund allocation. */
export interface ReturnItemFinancialHistoryRow {
  returnRequestId: string;
  returnStatus: string;
  returnItemId: string;
  orderItemId: string;
  quantity: number;
  refundAmount: string;
}

/** Returns a SQL false predicate when either required seller or store scope is empty. */
function sellerScopeCondition(scope: ReturnSellerScope): SQL {
  if (scope.sellerIds.length === 0 || scope.storeIds.length === 0) {
    return sql`false`;
  }

  return and(
    inArray(sellerOrders.sellerId, scope.sellerIds),
    inArray(sellerOrders.storeId, scope.storeIds),
  ) as SQL;
}

/** Combines only SQL predicates that are present so optional filters stay easy to read. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length === 0 ? undefined : and(...active);
}

/** Builds deterministic Return Request ordering from the validated allow-listed sort contract. */
function returnListSort(
  query: Pick<CustomerReturnListQuery, "sort" | "order">,
): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "returnNo":
      return [direction(returnRequests.returnNo), asc(returnRequests.id)];
    case "requestedAt":
    default:
      return [direction(returnRequests.requestedAt), asc(returnRequests.id)];
  }
}

/** Returns unique sorted IDs so transaction locks are always acquired in deterministic order. */
function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/**
 * Drizzle-only persistence boundary for Module 14 Returns, Refunds & Disputes.
 * Eligibility, lifecycle decisions, exact refund math, provider calls, restock policy, Commission calls, audit,
 * and outbox stay in services.
 */
export class ReturnsRefundsRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): ReturnsRefundsRepository {
    return new ReturnsRefundsRepository(executor);
  }

  /** Lists the authenticated customer's own Return Request headers with bounded filters. */
  async listCustomerReturns(
    customerUserId: string,
    query: CustomerReturnListQuery,
  ): Promise<PaginatedReturnRequestRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(returnRequests.customerUserId, customerUserId),
      query.status ? eq(returnRequests.status, query.status) : undefined,
      query.orderId ? eq(returnRequests.orderId, query.orderId) : undefined,
      query.requestedFrom
        ? gte(returnRequests.requestedAt, new Date(query.requestedFrom))
        : undefined,
      query.requestedTo
        ? lte(returnRequests.requestedAt, new Date(query.requestedTo))
        : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(returnRequests)
      .where(where)
      .orderBy(...returnListSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(returnRequests)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Lists Return Request headers only inside the actor's server-derived seller/store scope. */
  async listSellerReturns(
    scope: ReturnSellerScope,
    query: SellerReturnListQuery,
  ): Promise<PaginatedReturnRequestRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(scope),
      query.status ? eq(returnRequests.status, query.status) : undefined,
      query.orderId ? eq(returnRequests.orderId, query.orderId) : undefined,
      query.sellerOrderId
        ? eq(returnRequests.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.requestedFrom
        ? gte(returnRequests.requestedAt, new Date(query.requestedFrom))
        : undefined,
      query.requestedTo
        ? lte(returnRequests.requestedAt, new Date(query.requestedTo))
        : undefined,
    ]);

    const rows = await this.executor
      .select({ returnRequest: returnRequests })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .orderBy(...returnListSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where);

    return {
      items: rows.map((row) => row.returnRequest),
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Searches Return Request headers for privileged admins using only validated allow-listed filters. */
  async listAdminReturns(query: AdminReturnListQuery): Promise<PaginatedReturnRequestRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.status ? eq(returnRequests.status, query.status) : undefined,
      query.customerUserId
        ? eq(returnRequests.customerUserId, query.customerUserId)
        : undefined,
      query.sellerId ? eq(sellerOrders.sellerId, query.sellerId) : undefined,
      query.orderId ? eq(returnRequests.orderId, query.orderId) : undefined,
      query.sellerOrderId
        ? eq(returnRequests.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.requestedFrom
        ? gte(returnRequests.requestedAt, new Date(query.requestedFrom))
        : undefined,
      query.requestedTo
        ? lte(returnRequests.requestedAt, new Date(query.requestedTo))
        : undefined,
    ]);

    const rows = await this.executor
      .select({ returnRequest: returnRequests })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where)
      .orderBy(...returnListSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(where);

    return {
      items: rows.map((row) => row.returnRequest),
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Locks one Return Request by ID for an already-authorized internal/admin command. */
  async lockReturnById(returnRequestId: string): Promise<ReturnRequestRow | null> {
    const [row] = await this.executor
      .select()
      .from(returnRequests)
      .where(eq(returnRequests.id, returnRequestId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one Return Request only inside the actor's seller/store scope before a seller lifecycle command. */
  async lockReturnInSellerScope(
    returnRequestId: string,
    scope: ReturnSellerScope,
  ): Promise<ReturnRequestRow | null> {
    const [row] = await this.executor
      .select({ returnRequest: returnRequests })
      .from(returnRequests)
      .innerJoin(sellerOrders, eq(sellerOrders.id, returnRequests.sellerOrderId))
      .where(
        and(eq(returnRequests.id, returnRequestId), sellerScopeCondition(scope)),
      )
      .limit(1)
      .for("update");

    return row?.returnRequest ?? null;
  }

  /** Serializes Return quantity allocation for Order Items so concurrent requests cannot over-claim delivered quantity. */
  async lockReturnAllocations(orderItemIds: string[]): Promise<void> {
    for (const orderItemId of uniqueSortedIds(orderItemIds)) {
      const lockKey = `return-allocation:${orderItemId}`;
      await this.executor.execute(
        sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`,
      );
    }
  }

  /** Sums quantity reserved by every non-rejected Return Request for the supplied Order Items. */
  async sumNonRejectedReturnQuantities(
    orderItemIds: string[],
  ): Promise<ReturnQuantityReservationRow[]> {
    const uniqueOrderItemIds = uniqueSortedIds(orderItemIds);
    if (uniqueOrderItemIds.length === 0) return [];

    const rows = await this.executor
      .select({
        orderItemId: returnItems.orderItemId,
        reservedQuantity: sql<number>`sum(${returnItems.quantity})::int`,
      })
      .from(returnItems)
      .innerJoin(returnRequests, eq(returnRequests.id, returnItems.returnRequestId))
      .where(
        and(
          inArray(returnItems.orderItemId, uniqueOrderItemIds),
          ne(returnRequests.status, RETURN_REQUEST_STATUS.REJECTED),
        ),
      )
      .groupBy(returnItems.orderItemId)
      .orderBy(asc(returnItems.orderItemId));

    return rows.map((row) => ({
      orderItemId: row.orderItemId,
      reservedQuantity: Number(row.reservedQuantity),
    }));
  }

  /** Inserts one Return Request after the service has validated ownership, delivery, window, and quantity eligibility. */
  async createReturnRequest(
    input: CreateReturnRequestRecordInput,
  ): Promise<ReturnRequestRow> {
    const values: NewReturnRequestRow = {
      ...input,
      approvedAt: input.approvedAt ?? null,
    };
    const [row] = await this.executor.insert(returnRequests).values(values).returning();

    if (!row) {
      throw new Error("Return Request insert completed without returning a row.");
    }

    return row;
  }

  /** Inserts immutable requested quantities for one newly created Return Request. */
  async createReturnItems(
    returnRequestId: string,
    inputs: CreateReturnItemRecordInput[],
  ): Promise<ReturnItemRow[]> {
    if (inputs.length === 0) return [];

    const values: NewReturnItemRow[] = inputs.map((input) => ({
      id: input.id,
      returnRequestId,
      orderItemId: input.orderItemId,
      quantity: input.quantity,
    }));

    return this.executor.insert(returnItems).values(values).returning();
  }

  /** Lists every Return Item for one Return Request in deterministic ID order. */
  async listReturnItems(returnRequestId: string): Promise<ReturnItemRow[]> {
    return this.executor
      .select()
      .from(returnItems)
      .where(eq(returnItems.returnRequestId, returnRequestId))
      .orderBy(asc(returnItems.id));
  }

  /** Locks every Return Item for one Return Request before inspection or refund orchestration. */
  async lockReturnItems(returnRequestId: string): Promise<ReturnItemRow[]> {
    return this.executor
      .select()
      .from(returnItems)
      .where(eq(returnItems.returnRequestId, returnRequestId))
      .orderBy(asc(returnItems.id))
      .for("update");
  }

  /** Reads prior Return Item quantity/refund persistence needed for later cumulative exact refund calculations. */
  async listReturnItemFinancialHistory(
    orderItemIds: string[],
  ): Promise<ReturnItemFinancialHistoryRow[]> {
    const uniqueOrderItemIds = uniqueSortedIds(orderItemIds);
    if (uniqueOrderItemIds.length === 0) return [];

    return this.executor
      .select({
        returnRequestId: returnRequests.id,
        returnStatus: returnRequests.status,
        returnItemId: returnItems.id,
        orderItemId: returnItems.orderItemId,
        quantity: returnItems.quantity,
        refundAmount: returnItems.refundAmount,
      })
      .from(returnItems)
      .innerJoin(returnRequests, eq(returnRequests.id, returnItems.returnRequestId))
      .where(inArray(returnItems.orderItemId, uniqueOrderItemIds))
      .orderBy(
        asc(returnItems.orderItemId),
        asc(returnRequests.requestedAt),
        asc(returnItems.id),
      );
  }

  /** Persists a service-approved Return Request lifecycle state without deciding whether the transition is legal. */
  async updateReturnStatus(
    returnRequestId: string,
    input: UpdateReturnRequestStatusRecordInput,
  ): Promise<ReturnRequestRow | null> {
    const [row] = await this.executor
      .update(returnRequests)
      .set({
        status: input.status,
        ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
      })
      .where(eq(returnRequests.id, returnRequestId))
      .returning();

    return row ?? null;
  }

  /** Persists one service-approved item resolution inside the specified Return Request. */
  async updateReturnItemResolution(
    returnRequestId: string,
    returnItemId: string,
    input: UpdateReturnItemResolutionRecordInput,
  ): Promise<ReturnItemRow | null> {
    const [row] = await this.executor
      .update(returnItems)
      .set({
        itemCondition: input.itemCondition,
        resolution: input.resolution,
        restockQty: input.restockQty,
      })
      .where(
        and(
          eq(returnItems.id, returnItemId),
          eq(returnItems.returnRequestId, returnRequestId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Persists only the final service-calculated refund amount for one item in the specified Return Request. */
  async updateReturnItemRefund(
    returnRequestId: string,
    returnItemId: string,
    input: UpdateReturnItemRefundRecordInput,
  ): Promise<ReturnItemRow | null> {
    const [row] = await this.executor
      .update(returnItems)
      .set({ refundAmount: input.refundAmount })
      .where(
        and(
          eq(returnItems.id, returnItemId),
          eq(returnItems.returnRequestId, returnRequestId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Appends one immutable Return Request lifecycle-history row. */
  async appendStatusHistory(
    returnRequestId: string,
    input: CreateReturnStatusHistoryRecordInput,
  ): Promise<ReturnStatusHistoryRow> {
    const values: NewReturnStatusHistoryRow = {
      returnRequestId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedBy: input.changedBy,
      reason: input.reason ?? null,
      changedAt: input.changedAt ?? new Date(),
    };
    const [row] = await this.executor
      .insert(returnStatusHistory)
      .values(values)
      .returning();

    if (!row) {
      throw new Error("Return status history insert completed without returning a row.");
    }

    return row;
  }

  /** Lists append-only lifecycle history for one Return Request in deterministic chronological order. */
  async listStatusHistory(returnRequestId: string): Promise<ReturnStatusHistoryRow[]> {
    return this.executor
      .select()
      .from(returnStatusHistory)
      .where(eq(returnStatusHistory.returnRequestId, returnRequestId))
      .orderBy(asc(returnStatusHistory.changedAt), asc(returnStatusHistory.id));
  }

  /** Finds one business Refund row by the command's persistent idempotency key. */
  async findRefundByIdempotencyKey(idempotencyKey: string): Promise<RefundRow | null> {
    const [row] = await this.executor
      .select()
      .from(refunds)
      .where(eq(refunds.idempotencyKey, idempotencyKey))
      .limit(1);

    return row ?? null;
  }

  /** Lists persisted business Refund rows for one Return Request without interpreting provider status. */
  async listRefundsForReturn(returnRequestId: string): Promise<RefundRow[]> {
    return this.executor
      .select()
      .from(refunds)
      .where(eq(refunds.returnRequestId, returnRequestId))
      .orderBy(asc(refunds.createdAt), asc(refunds.id));
  }

  /** Inserts one business Refund row or returns null when the same idempotency key already won the insert race. */
  async createRefundIfMissing(input: CreateRefundRecordInput): Promise<RefundRow | null> {
    const values: NewRefundRow = {
      ...input,
      providerRef: input.providerRef ?? null,
      createdAt: input.createdAt ?? new Date(),
      updatedAt: input.updatedAt ?? new Date(),
    };
    const [row] = await this.executor
      .insert(refunds)
      .values(values)
      .onConflictDoNothing({ target: refunds.idempotencyKey })
      .returning();

    return row ?? null;
  }

  /** Persists provider-authoritative Refund result fields without changing the original amount/currency/source identity. */
  async updateRefundResult(
    refundId: string,
    input: UpdateRefundResultRecordInput,
  ): Promise<RefundRow | null> {
    const [row] = await this.executor
      .update(refunds)
      .set({
        status: input.status,
        providerRef: input.providerRef ?? null,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(refunds.id, refundId))
      .returning();

    return row ?? null;
  }
}
