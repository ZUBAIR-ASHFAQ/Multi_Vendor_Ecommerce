import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  inventoryItems,
  stockMovements,
  stockReservations,
  type InventoryItemRow,
  type NewInventoryItemRow,
  type NewStockMovementRow,
  type NewStockReservationRow,
  type StockMovementRow,
  type StockReservationRow,
} from "../../database/schema/inventory.js";
import { products, productVariants } from "../../database/schema/products.js";
import { stores } from "../../database/schema/sellers.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { STOCK_RESERVATION_STATUS } from "./inventory.constants.js";
import type {
  SellerInventoryListQuery,
  StockMovementListQuery,
} from "./inventory.schema.js";

/** Server-derived seller/store IDs that must constrain every private Inventory query. */
export interface InventorySellerScope {
  sellerIds: string[];
  storeIds: string[];
}

/** Seller/store/variant ownership fields used when the service initializes an Inventory row. */
export interface CreateInventoryItemRecordInput {
  sellerId: string;
  storeId: string;
  variantId: string;
}

/** Immutable stock-ledger values already authorized and decided by the service. */
export interface CreateStockMovementRecordInput {
  inventoryItemId: string;
  movementType: StockMovementRow["movementType"];
  quantityDelta: number;
  sourceType: string;
  sourceId?: string | null;
  idempotencyKey: string;
  actorUserId?: string | null;
  occurredAt?: Date;
}

/** Reservation values already validated by the service before persistence. */
export interface CreateStockReservationRecordInput {
  variantId: string;
  customerUserId: string;
  orderAttemptId?: string | null;
  qty: number;
  status?: StockReservationRow["status"];
  expiresAt: Date;
  sourceKey: string;
}

/** One seller Inventory list row with Product/variant/Store display context. */
export interface SellerInventoryListRow {
  inventory: InventoryItemRow;
  productId: string;
  productName: string;
  productSlug: string;
  variantSku: string;
  variantTitle: string;
  variantStatus: string;
  variantPrice: string;
  variantCurrency: string;
  storeName: string;
}

/** Paginated seller-scoped Inventory rows returned by repository list reads. */
export interface PaginatedInventoryRows {
  items: SellerInventoryListRow[];
  totalItems: number;
}

/** Paginated immutable movement rows returned by seller-scoped history reads. */
export interface PaginatedStockMovementRows {
  items: StockMovementRow[];
  totalItems: number;
}

/** Authoritative stock balances used by trusted Checkout availability reads. */
export interface InventoryAvailabilityRow {
  variantId: string;
  onHandQty: number;
  reservedQty: number;
}

/** Returns a SQL false predicate when a required seller/store scope is empty. */
function inventorySellerScopeCondition(scope: InventorySellerScope): SQL {
  if (scope.sellerIds.length === 0 || scope.storeIds.length === 0) {
    return sql`false`;
  }

  return and(
    inArray(inventoryItems.sellerId, scope.sellerIds),
    inArray(inventoryItems.storeId, scope.storeIds),
  ) as SQL;
}

/** Combines only SQL predicates that are actually present. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Builds the persisted low-stock predicate from on-hand, reserved, and reorder quantities. */
function lowStockCondition(enabled: boolean | undefined): SQL | undefined {
  if (enabled !== true) return undefined;

  return and(
    isNotNull(inventoryItems.reorderLevel),
    sql`${inventoryItems.onHandQty} - ${inventoryItems.reservedQty} <= ${inventoryItems.reorderLevel}`,
  ) as SQL;
}

/**
 * Persistence-only Module 7 repository.
 * Permissions, seller lifecycle, quantity decisions, reservation transitions, audit, and outbox behavior stay in services.
 */
export class InventoryRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Lists Inventory rows only inside the server-derived seller/store scope. */
  async listSellerInventory(
    scope: InventorySellerScope,
    query: SellerInventoryListQuery,
  ): Promise<PaginatedInventoryRows> {
    const { limit, offset } = toLimitOffset(query);
    const search = query.q ? `%${query.q}%` : null;
    const where = combineConditions([
      inventorySellerScopeCondition(scope),
      query.storeId ? eq(inventoryItems.storeId, query.storeId) : undefined,
      query.variantId ? eq(inventoryItems.variantId, query.variantId) : undefined,
      search
        ? or(
            ilike(products.name, search),
            ilike(products.slug, search),
            ilike(productVariants.sku, search),
            ilike(productVariants.title, search),
          )
        : undefined,
      lowStockCondition(query.lowStock),
    ]);

    const items = await this.executor
      .select({
        inventory: inventoryItems,
        productId: products.id,
        productName: products.name,
        productSlug: products.slug,
        variantSku: productVariants.sku,
        variantTitle: productVariants.title,
        variantStatus: productVariants.status,
        variantPrice: productVariants.price,
        variantCurrency: productVariants.currency,
        storeName: stores.name,
      })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(stores, eq(stores.id, inventoryItems.storeId))
      .where(where)
      .orderBy(desc(inventoryItems.updatedAt), asc(inventoryItems.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(stores, eq(stores.id, inventoryItems.storeId))
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Reads one Inventory row by variant only inside the server-derived seller/store scope. */
  async findInventoryItemByVariantInSellerScope(
    variantId: string,
    scope: InventorySellerScope,
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          inventorySellerScopeCondition(scope),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Locks one seller-scoped Inventory row before a manual quantity or threshold write. */
  async findInventoryItemByVariantInSellerScopeForUpdate(
    variantId: string,
    scope: InventorySellerScope,
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          inventorySellerScopeCondition(scope),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one Inventory row by variant for trusted internal reserve/release/ship commands. */
  async findInventoryItemByVariantForUpdate(
    variantId: string,
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.variantId, variantId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Creates the zero-balance Inventory row when it does not already exist for the seller/store variant. */
  async createInventoryItemIfMissing(
    input: CreateInventoryItemRecordInput,
  ): Promise<InventoryItemRow | null> {
    const values: NewInventoryItemRow = {
      sellerId: input.sellerId,
      storeId: input.storeId,
      variantId: input.variantId,
      onHandQty: 0,
      reservedQty: 0,
    };

    const [row] = await this.executor
      .insert(inventoryItems)
      .values(values)
      .onConflictDoNothing({
        target: [inventoryItems.storeId, inventoryItems.variantId],
      })
      .returning();

    return row ?? null;
  }

  /** Updates one seller-scoped reorder threshold after the service has validated the command. */
  async updateReorderLevelInSellerScope(
    variantId: string,
    scope: InventorySellerScope,
    reorderLevel: number | null,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({ reorderLevel, updatedAt })
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          inventorySellerScopeCondition(scope),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Applies a seller-scoped on-hand delta only when the resulting balance can still cover reserved stock. */
  async applyOnHandAdjustmentInSellerScope(
    variantId: string,
    scope: InventorySellerScope,
    quantityDelta: number,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({
        onHandQty: sql`${inventoryItems.onHandQty} + ${quantityDelta}`,
        updatedAt,
      })
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          inventorySellerScopeCondition(scope),
          sql`${inventoryItems.onHandQty} + ${quantityDelta} >= ${inventoryItems.reservedQty}`,
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Increases reserved quantity only when enough persisted available stock remains. */
  async increaseReservedQuantity(
    inventoryItemId: string,
    quantity: number,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({
        reservedQty: sql`${inventoryItems.reservedQty} + ${quantity}`,
        updatedAt,
      })
      .where(
        and(
          eq(inventoryItems.id, inventoryItemId),
          sql`${inventoryItems.onHandQty} - ${inventoryItems.reservedQty} >= ${quantity}`,
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Decreases reserved quantity only when the persisted reservation balance can cover the release. */
  async decreaseReservedQuantity(
    inventoryItemId: string,
    quantity: number,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({
        reservedQty: sql`${inventoryItems.reservedQty} - ${quantity}`,
        updatedAt,
      })
      .where(
        and(
          eq(inventoryItems.id, inventoryItemId),
          sql`${inventoryItems.reservedQty} >= ${quantity}`,
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Consumes physical and reserved stock together for a service-authorized shipment quantity. */
  async consumeReservedQuantity(
    inventoryItemId: string,
    quantity: number,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({
        onHandQty: sql`${inventoryItems.onHandQty} - ${quantity}`,
        reservedQty: sql`${inventoryItems.reservedQty} - ${quantity}`,
        updatedAt,
      })
      .where(
        and(
          eq(inventoryItems.id, inventoryItemId),
          sql`${inventoryItems.onHandQty} >= ${quantity}`,
          sql`${inventoryItems.reservedQty} >= ${quantity}`,
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Increases one locked Inventory row's physical on-hand quantity for a trusted restock command. */
  async increaseOnHandQuantity(
    inventoryItemId: string,
    quantity: number,
    updatedAt: Date = new Date(),
  ): Promise<InventoryItemRow | null> {
    const [row] = await this.executor
      .update(inventoryItems)
      .set({
        onHandQty: sql`${inventoryItems.onHandQty} + ${quantity}`,
        updatedAt,
      })
      .where(eq(inventoryItems.id, inventoryItemId))
      .returning();

    return row ?? null;
  }

  /** Lists immutable stock movements for one variant only inside the server-derived seller/store scope. */
  async listMovementsByVariantInSellerScope(
    variantId: string,
    scope: InventorySellerScope,
    query: StockMovementListQuery,
  ): Promise<PaginatedStockMovementRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = and(
      eq(inventoryItems.variantId, variantId),
      inventorySellerScopeCondition(scope),
    );

    const rows = await this.executor
      .select({ movement: stockMovements })
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.inventoryItemId))
      .where(where)
      .orderBy(desc(stockMovements.occurredAt), asc(stockMovements.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.inventoryItemId))
      .where(where);

    return {
      items: rows.map((row) => row.movement),
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads one immutable movement by its globally unique idempotency key. */
  async findMovementByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StockMovementRow | null> {
    const [row] = await this.executor
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.idempotencyKey, idempotencyKey))
      .limit(1);

    return row ?? null;
  }

  /** Reads authoritative on-hand and reserved balances for the requested variants only. */
  async listAvailabilityByVariantIds(
    variantIds: string[],
  ): Promise<InventoryAvailabilityRow[]> {
    const uniqueVariantIds = [...new Set(variantIds)];
    if (uniqueVariantIds.length === 0) return [];

    return this.executor
      .select({
        variantId: inventoryItems.variantId,
        onHandQty: inventoryItems.onHandQty,
        reservedQty: inventoryItems.reservedQty,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.variantId, uniqueVariantIds))
      .orderBy(asc(inventoryItems.variantId));
  }

  /** Returns whether any supplied variant currently has positive authoritative available quantity. */
  async hasAvailableStockForVariants(variantIds: string[]): Promise<boolean> {
    const uniqueVariantIds = [...new Set(variantIds)];
    if (uniqueVariantIds.length === 0) return false;

    const [row] = await this.executor
      .select({ variantId: inventoryItems.variantId })
      .from(inventoryItems)
      .where(
        and(
          inArray(inventoryItems.variantId, uniqueVariantIds),
          sql`${inventoryItems.onHandQty} - ${inventoryItems.reservedQty} > 0`,
        ),
      )
      .limit(1);

    return Boolean(row);
  }

  /** Appends one immutable stock movement; this repository never updates or deletes movement history. */
  async createMovement(
    input: CreateStockMovementRecordInput,
  ): Promise<StockMovementRow> {
    const values: NewStockMovementRow = {
      inventoryItemId: input.inventoryItemId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId ?? null,
      occurredAt: input.occurredAt,
    };

    const [row] = await this.executor.insert(stockMovements).values(values).returning();
    if (!row) throw new Error("Stock movement insert completed without returning a row.");
    return row;
  }

  /** Reads one reservation by the globally unique source key used for reserve-command idempotency. */
  async findReservationBySourceKey(sourceKey: string): Promise<StockReservationRow | null> {
    const [row] = await this.executor
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.sourceKey, sourceKey))
      .limit(1);

    return row ?? null;
  }

  /** Finds a bounded oldest-first batch of uncommitted reservations whose temporary hold has expired. */
  async findExpiredReservedReservations(
    now: Date,
    limit: number,
  ): Promise<StockReservationRow[]> {
    if (limit <= 0) return [];

    return this.executor
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.status, STOCK_RESERVATION_STATUS.RESERVED),
          lte(stockReservations.expiresAt, now),
        ),
      )
      .orderBy(asc(stockReservations.expiresAt), asc(stockReservations.id))
      .limit(limit);
  }

  /** Locks one reservation before a service-owned commit, release, expiry, or shipment transition. */
  async findReservationByIdForUpdate(
    reservationId: string,
  ): Promise<StockReservationRow | null> {
    const [row] = await this.executor
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, reservationId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Creates one reservation after the service has atomically reserved the matching Inventory quantity. */
  async createReservation(
    input: CreateStockReservationRecordInput,
  ): Promise<StockReservationRow> {
    const values: NewStockReservationRow = {
      variantId: input.variantId,
      customerUserId: input.customerUserId,
      orderAttemptId: input.orderAttemptId ?? null,
      qty: input.qty,
      status: input.status,
      expiresAt: input.expiresAt,
      sourceKey: input.sourceKey,
    };

    const [row] = await this.executor.insert(stockReservations).values(values).returning();
    if (!row) throw new Error("Stock reservation insert completed without returning a row.");
    return row;
  }

  /** Persists service-approved partial shipment consumption after the reservation has been locked and validated. */
  async updateReservationConsumption(
    reservationId: string,
    consumedQty: number,
    status: StockReservationRow["status"],
    updatedAt: Date = new Date(),
  ): Promise<StockReservationRow | null> {
    const [row] = await this.executor
      .update(stockReservations)
      .set({ consumedQty, status, updatedAt })
      .where(eq(stockReservations.id, reservationId))
      .returning();

    return row ?? null;
  }

  /** Persists service-approved released-quantity accounting after the reservation row has been locked. */
  async updateReservationReleaseAccounting(
    reservationId: string,
    releasedQty: number,
    status: StockReservationRow["status"],
    updatedAt: Date = new Date(),
  ): Promise<StockReservationRow | null> {
    const [row] = await this.executor
      .update(stockReservations)
      .set({ releasedQty, status, updatedAt })
      .where(eq(stockReservations.id, reservationId))
      .returning();

    return row ?? null;
  }

  /** Persists one service-approved reservation status after the service has locked and validated the transition. */
  async updateReservationStatus(
    reservationId: string,
    status: StockReservationRow["status"],
    updatedAt: Date = new Date(),
  ): Promise<StockReservationRow | null> {
    const [row] = await this.executor
      .update(stockReservations)
      .set({ status, updatedAt })
      .where(eq(stockReservations.id, reservationId))
      .returning();

    return row ?? null;
  }
}
