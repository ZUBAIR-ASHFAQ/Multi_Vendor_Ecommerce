import { createHash } from "node:crypto";
import type {
  InventoryItemRow,
  StockMovementRow,
  StockReservationRow,
} from "../../database/schema/inventory.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { ProductsService } from "../products/products.service.js";
import {
  INVENTORY_AUDIT_ACTION,
  INVENTORY_ERROR_CODE,
  INVENTORY_LIMITS,
  INVENTORY_OUTBOX_EVENT,
  INVENTORY_PERMISSION,
  INVENTORY_RESOURCE_TYPE,
  INVENTORY_SOURCE_TYPE,
  STOCK_MOVEMENT_TYPE,
  STOCK_RESERVATION_STATUS,
} from "./inventory.constants.js";
import {
  InventoryRepository,
  type InventorySellerScope,
  type SellerInventoryListRow,
} from "./inventory.repository.js";
import type {
  AdjustStockInput,
  CommitStockReservationInput,
  InventoryItemResponse,
  ReleaseStockInput,
  SellerInventoryListItemResponse,
  ReserveStockInput,
  SellerInventoryListQuery,
  ShipStockInput,
  StockMovementListQuery,
  StockMovementResponse,
  StockReservationResponse,
  UpdateReorderLevelInput,
} from "./inventory.schema.js";

/** Runs one Module 7 transaction and allows focused service tests to replace the real database boundary. */
export type InventoryTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Small Product boundary used to authorize a seller-owned variant without importing Product persistence. */
export interface InventoryProductIntegration {
  /** Resolves one variant to seller/store ownership only when the actor has the requested seller-scoped permission. */
  resolveVariantSellerStoreForCommand(
    context: RequestContext,
    variantId: string,
    permission: PermissionCode,
  ): Promise<{ variantId: string; productId: string; sellerId: string; storeId: string }>;
}

/** Explicit dependencies keep Inventory service logic testable without a framework container. */
export interface InventoryServiceDependencies {
  repository?: InventoryRepository;
  transactionRunner?: InventoryTransactionRunner;
  products?: InventoryProductIntegration;
  now?: () => Date;
}

/** Paginated seller Inventory result returned before the HTTP envelope is applied. */
export interface PaginatedInventoryResult {
  items: SellerInventoryListItemResponse[];
  meta: PaginationMeta;
}

/** Paginated immutable stock-movement result returned before the HTTP envelope is applied. */
export interface PaginatedStockMovementResult {
  items: StockMovementResponse[];
  meta: PaginationMeta;
}

/** One server-derived Checkout quantity request used only for authoritative stock validation. */
export interface CheckoutInventoryRequest {
  variantId: string;
  quantity: number;
}

/** Authoritative available quantity for one Checkout variant request. */
export interface CheckoutInventoryAvailability {
  variantId: string;
  requestedQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
}

/** Trusted in-process partial-release command used by Module 11 Order cancellation. */
export interface ReleaseReservationQuantityInput {
  reservationId: string;
  quantity: number;
  sourceKey: string;
}

/** Trusted system-only Return restock command; seller/store ownership is rechecked against Inventory. */
export interface RestockStockInput {
  sellerId: string;
  storeId: string;
  variantId: string;
  quantity: number;
  sourceId: string;
  sourceKey: string;
}

/** Creates one stable Module 7 business error. */
function inventoryError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Trusted committed-reservation facts exposed to Module 13 Shipping. */
export interface ShippingReservationSnapshot {
  reservationId: string;
  variantId: string;
  remainingQuantity: number;
  status: string;
}

/** Module 7 business service for seller-safe stock reads/writes and retry-safe internal stock commands. */
export class InventoryService {
  private readonly repository: InventoryRepository;
  private readonly transactionRunner: InventoryTransactionRunner;
  private readonly products: InventoryProductIntegration;
  private readonly now: () => Date;

  /** Stores explicit dependencies while keeping the default application composition simple. */
  constructor(dependencies: InventoryServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new InventoryRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.products = dependencies.products ?? new ProductsService();
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Creates an Inventory service that participates in an existing cross-module transaction. */
  static using(transaction: DatabaseTransaction): InventoryService {
    return new InventoryService({
      repository: new InventoryRepository(transaction),
      transactionRunner: async (work) => work(transaction),
    });
  }

  /** Lists Inventory only inside seller/store scopes where inventory.read is effective. */
  async listSellerInventory(
    context: RequestContext,
    query: SellerInventoryListQuery,
  ): Promise<PaginatedInventoryResult> {
    const scope = this.resolveSellerScope(context, INVENTORY_PERMISSION.READ);
    this.assertRequestedStoreInScope(query.storeId, scope);
    const result = await this.repository.listSellerInventory(scope, query);

    return {
      items: result.items.map((item) => this.toSellerInventoryListItemResponse(item)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists immutable movement history for one seller-owned Product variant. */
  async listStockMovements(
    context: RequestContext,
    variantId: string,
    query: StockMovementListQuery,
  ): Promise<PaginatedStockMovementResult> {
    const scope = this.resolveSellerScope(context, INVENTORY_PERMISSION.READ);
    const item = await this.repository.findInventoryItemByVariantInSellerScope(variantId, scope);
    if (!item) throw this.inventoryNotFound();

    const result = await this.repository.listMovementsByVariantInSellerScope(
      variantId,
      scope,
      query,
    );
    return {
      items: result.items.map((movement) => this.toMovementResponse(movement)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Applies one controlled seller stock adjustment and appends exactly one immutable movement. */
  async adjustStock(
    context: RequestContext,
    variantId: string,
    input: AdjustStockInput,
  ): Promise<InventoryItemResponse> {
    const actorId = this.requireActorId(context);
    const scope = this.resolveSellerScope(context, INVENTORY_PERMISSION.ADJUST);
    const movementKey = this.movementKey("adjust", context.requestId);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const existing = await this.ensureSellerInventoryItem(
          repository,
          context,
          scope,
          variantId,
          INVENTORY_PERMISSION.ADJUST,
        );
        const duplicate = await repository.findMovementByIdempotencyKey(movementKey);
        if (duplicate) {
          this.assertMovementMatches(
            duplicate,
            existing.id,
            STOCK_MOVEMENT_TYPE.ADJUSTMENT,
            input.quantityDelta,
            INVENTORY_SOURCE_TYPE.SELLER_ADJUSTMENT,
            null,
          );
          return this.toInventoryResponse(existing);
        }

        const updated = await repository.applyOnHandAdjustmentInSellerScope(
          variantId,
          scope,
          input.quantityDelta,
          this.now(),
        );
        if (!updated) throw this.stockAdjustmentInvalid();

        const movement = await repository.createMovement({
          inventoryItemId: updated.id,
          movementType: STOCK_MOVEMENT_TYPE.ADJUSTMENT,
          quantityDelta: input.quantityDelta,
          sourceType: INVENTORY_SOURCE_TYPE.SELLER_ADJUSTMENT,
          sourceId: null,
          idempotencyKey: movementKey,
          actorUserId: actorId,
          occurredAt: this.now(),
        });

        await AuditService.using(tx).record({
          actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.ADJUSTED,
          entityType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
          entityId: updated.id,
          sellerId: updated.sellerId,
          requestId: context.requestId,
          before: this.toInventoryResponse(existing),
          after: this.toInventoryResponse(updated),
          metadata: { movementId: movement.id, sourceKey: movementKey },
        });
        const outbox = OutboxService.using(tx);
        await outbox.enqueue({
          eventType: INVENTORY_OUTBOX_EVENT.ADJUSTED,
          aggregateType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
          aggregateId: updated.id,
          payload: {
            inventoryItemId: updated.id,
            sellerId: updated.sellerId,
            storeId: updated.storeId,
            variantId,
            quantityDelta: input.quantityDelta,
            onHandQty: updated.onHandQty,
            reservedQty: updated.reservedQty,
            availableQty: this.availableQuantity(updated),
          },
        });
        await this.enqueueLowStockIfEntered(outbox, existing, updated);

        return this.toInventoryResponse(updated);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Updates one seller-owned low-stock threshold without changing physical or reserved stock. */
  async updateReorderLevel(
    context: RequestContext,
    variantId: string,
    input: UpdateReorderLevelInput,
  ): Promise<InventoryItemResponse> {
    const actorId = this.requireActorId(context);
    const scope = this.resolveSellerScope(context, INVENTORY_PERMISSION.REORDER_MANAGE);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const existing = await this.ensureSellerInventoryItem(
          repository,
          context,
          scope,
          variantId,
          INVENTORY_PERMISSION.REORDER_MANAGE,
        );
        const updated = await repository.updateReorderLevelInSellerScope(
          variantId,
          scope,
          input.reorderLevel,
          this.now(),
        );
        if (!updated) throw this.inventoryNotFound();

        await AuditService.using(tx).record({
          actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.REORDER_LEVEL_UPDATED,
          entityType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
          entityId: updated.id,
          sellerId: updated.sellerId,
          requestId: context.requestId,
          before: { reorderLevel: existing.reorderLevel },
          after: { reorderLevel: updated.reorderLevel },
        });
        await this.enqueueLowStockIfEntered(OutboxService.using(tx), existing, updated);
        return this.toInventoryResponse(updated);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Creates one retry-safe stock reservation after locking the variant Inventory row and checking available quantity. */
  async reserveStock(
    context: RequestContext,
    input: ReserveStockInput,
  ): Promise<StockReservationResponse> {
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= this.now().getTime()) throw this.reservationExpired();
    const movementKey = this.movementKey("reserve", input.sourceKey);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const item = await repository.findInventoryItemByVariantForUpdate(input.variantId);
        if (!item) throw this.inventoryNotFound();

        const existingReservation = await repository.findReservationBySourceKey(input.sourceKey);
        if (existingReservation) {
          this.assertReservationMatchesReserve(existingReservation, input, expiresAt);
          return this.toReservationResponse(existingReservation);
        }
        if (await repository.findMovementByIdempotencyKey(movementKey)) {
          throw this.duplicateStockSource();
        }

        const before = item;
        const updated = await repository.increaseReservedQuantity(
          item.id,
          input.quantity,
          this.now(),
        );
        if (!updated) throw this.insufficientStock();

        const reservation = await repository.createReservation({
          variantId: input.variantId,
          customerUserId: input.customerUserId,
          orderAttemptId: input.orderAttemptId ?? null,
          qty: input.quantity,
          status: STOCK_RESERVATION_STATUS.RESERVED,
          expiresAt,
          sourceKey: input.sourceKey,
        });
        const movement = await repository.createMovement({
          inventoryItemId: item.id,
          movementType: STOCK_MOVEMENT_TYPE.RESERVE,
          quantityDelta: input.quantity,
          sourceType: INVENTORY_SOURCE_TYPE.RESERVATION,
          sourceId: reservation.id,
          idempotencyKey: movementKey,
          actorUserId: context.actorId,
          occurredAt: this.now(),
        });

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.RESERVED,
          entityType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          entityId: reservation.id,
          sellerId: item.sellerId,
          requestId: context.requestId,
          after: this.toReservationResponse(reservation),
          metadata: { inventoryItemId: item.id, movementId: movement.id, sourceKey: input.sourceKey },
        });
        const outbox = OutboxService.using(tx);
        await outbox.enqueue({
          eventType: INVENTORY_OUTBOX_EVENT.RESERVED,
          aggregateType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          aggregateId: reservation.id,
          payload: {
            reservationId: reservation.id,
            inventoryItemId: item.id,
            sellerId: item.sellerId,
            storeId: item.storeId,
            variantId: item.variantId,
            quantity: reservation.qty,
            expiresAt: reservation.expiresAt.toISOString(),
          },
        });
        await this.enqueueLowStockIfEntered(outbox, before, updated);

        return this.toReservationResponse(reservation);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Moves one live reservation to committed exactly once before later fulfillment consumes it. */
  async commitStockReservation(
    context: RequestContext,
    input: CommitStockReservationInput,
  ): Promise<StockReservationResponse> {
    return this.transactionRunner(async (tx) => {
      const repository = new InventoryRepository(tx);
      const reservation = await repository.findReservationByIdForUpdate(input.reservationId);
      if (!reservation) throw this.reservationNotFound();
      if (reservation.status === STOCK_RESERVATION_STATUS.COMMITTED) {
        return this.toReservationResponse(reservation);
      }
      if (reservation.status !== STOCK_RESERVATION_STATUS.RESERVED) {
        throw this.reservationStatusInvalid();
      }
      if (reservation.expiresAt.getTime() <= this.now().getTime()) {
        throw this.reservationExpired();
      }

      const updated = await repository.updateReservationStatus(
        reservation.id,
        STOCK_RESERVATION_STATUS.COMMITTED,
        this.now(),
      );
      if (!updated) throw this.reservationNotFound();
      const item = await repository.findInventoryItemByVariantForUpdate(reservation.variantId);
      if (!item) throw this.inventoryNotFound();

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: INVENTORY_AUDIT_ACTION.RESERVATION_COMMITTED,
        entityType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
        entityId: reservation.id,
        sellerId: item.sellerId,
        requestId: context.requestId,
        before: { status: reservation.status },
        after: { status: updated.status },
        metadata: { sourceKey: reservation.sourceKey },
      });
      return this.toReservationResponse(updated);
    });
  }

  /** Releases one live reservation once and restores its reserved quantity without editing movement history. */
  async releaseStock(
    context: RequestContext,
    input: ReleaseStockInput,
  ): Promise<StockReservationResponse> {
    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const reservation = await repository.findReservationByIdForUpdate(input.reservationId);
        if (!reservation) throw this.reservationNotFound();

        return this.releaseLockedReservation(
          tx,
          repository,
          context,
          reservation,
          input.sourceKey,
          this.now(),
        );
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Releases part or all of one still-reserved quantity for an in-process Order cancellation. */
  async releaseReservationQuantity(
    context: RequestContext,
    input: ReleaseReservationQuantityInput,
  ): Promise<StockReservationResponse> {
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity <= 0 ||
      input.quantity > INVENTORY_LIMITS.MAX_QUANTITY
    ) {
      throw this.stockAdjustmentInvalid(
        `Release quantity must be a positive integer up to ${INVENTORY_LIMITS.MAX_QUANTITY}.`,
      );
    }

    const movementKey = this.movementKey("release", input.sourceKey);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const reservation = await repository.findReservationByIdForUpdate(input.reservationId);
        if (!reservation) throw this.reservationNotFound();

        const item = await repository.findInventoryItemByVariantForUpdate(reservation.variantId);
        if (!item) throw this.inventoryNotFound();

        const duplicate = await repository.findMovementByIdempotencyKey(movementKey);
        if (duplicate) {
          this.assertMovementMatches(
            duplicate,
            item.id,
            STOCK_MOVEMENT_TYPE.RELEASE,
            -input.quantity,
            INVENTORY_SOURCE_TYPE.RESERVATION_RELEASE,
            reservation.id,
          );
          return this.toReservationResponse(reservation);
        }

        if (reservation.status !== STOCK_RESERVATION_STATUS.RESERVED) {
          throw this.reservationStatusInvalid();
        }

        const remainingQuantity = this.unaccountedReservationQuantity(reservation);
        if (input.quantity > remainingQuantity) {
          throw this.stockAdjustmentInvalid(
            "Release quantity exceeds the reservation quantity that is still reserved.",
          );
        }

        const inventory = await repository.decreaseReservedQuantity(
          item.id,
          input.quantity,
          this.now(),
        );
        if (!inventory) throw this.stockAdjustmentInvalid();

        const releasedQuantity = reservation.releasedQty + input.quantity;
        const nextStatus =
          reservation.qty - reservation.consumedQty - releasedQuantity === 0
            ? STOCK_RESERVATION_STATUS.RELEASED
            : STOCK_RESERVATION_STATUS.RESERVED;
        const updated = await repository.updateReservationReleaseAccounting(
          reservation.id,
          releasedQuantity,
          nextStatus,
          this.now(),
        );
        if (!updated) throw this.reservationNotFound();

        const movement = await repository.createMovement({
          inventoryItemId: item.id,
          movementType: STOCK_MOVEMENT_TYPE.RELEASE,
          quantityDelta: -input.quantity,
          sourceType: INVENTORY_SOURCE_TYPE.RESERVATION_RELEASE,
          sourceId: reservation.id,
          idempotencyKey: movementKey,
          actorUserId: context.actorId,
          occurredAt: this.now(),
        });

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.RESERVATION_RELEASED,
          entityType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          entityId: reservation.id,
          sellerId: item.sellerId,
          requestId: context.requestId,
          before: this.toReservationResponse(reservation),
          after: this.toReservationResponse(updated),
          metadata: {
            inventoryItemId: item.id,
            movementId: movement.id,
            sourceKey: input.sourceKey,
            releasedQuantity: input.quantity,
          },
        });
        await OutboxService.using(tx).enqueue({
          eventType: INVENTORY_OUTBOX_EVENT.RESERVATION_RELEASED,
          aggregateType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          aggregateId: reservation.id,
          payload: {
            reservationId: reservation.id,
            inventoryItemId: item.id,
            sellerId: item.sellerId,
            storeId: item.storeId,
            variantId: item.variantId,
            quantity: input.quantity,
            consumedQuantity: updated.consumedQty,
            remainingQuantity: this.remainingReservationQuantity(updated),
            status: updated.status,
            availableQty: this.availableQuantity(inventory),
          },
        });

        return this.toReservationResponse(updated);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Releases a bounded batch of expired temporary holds while leaving committed reservations untouched. */
  async releaseExpiredReservations(limit = 100): Promise<number> {
    const now = this.now();

    try {
      const candidates = await this.repository.findExpiredReservedReservations(now, limit);
      let releasedCount = 0;

      // Process one reservation at a time so each release keeps a small independent transaction.
      for (const reservation of candidates) {
        if (await this.expireReservationIfStillEligible(reservation.id, now)) {
          releasedCount += 1;
        }
      }

      return releasedCount;
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Validates one committed reservation and returns its remaining quantity for Shipment allocation. */
  async getShippingReservationSnapshot(
    reservationId: string,
  ): Promise<ShippingReservationSnapshot> {
    return this.transactionRunner(async (tx) => {
      const repository = new InventoryRepository(tx);
      const reservation = await repository.findReservationByIdForUpdate(reservationId);
      if (!reservation) throw this.reservationNotFound();
      if (reservation.status !== STOCK_RESERVATION_STATUS.COMMITTED) {
        throw this.reservationStatusInvalid();
      }

      return {
        reservationId: reservation.id,
        variantId: reservation.variantId,
        remainingQuantity: this.unaccountedReservationQuantity(reservation),
        status: reservation.status,
      };
    });
  }

  /** Consumes part or all of one committed reservation without allowing shipment beyond its remaining quantity. */
  async shipStock(
    context: RequestContext,
    input: ShipStockInput,
  ): Promise<StockReservationResponse> {
    const movementKey = this.movementKey("ship", input.sourceKey);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const reservation = await repository.findReservationByIdForUpdate(input.reservationId);
        if (!reservation) throw this.reservationNotFound();

        const item = await repository.findInventoryItemByVariantForUpdate(reservation.variantId);
        if (!item) throw this.inventoryNotFound();

        const duplicate = await repository.findMovementByIdempotencyKey(movementKey);
        if (duplicate) {
          this.assertMovementMatches(
            duplicate,
            item.id,
            STOCK_MOVEMENT_TYPE.SHIP,
            -input.quantity,
            INVENTORY_SOURCE_TYPE.SHIPMENT,
            input.sourceId,
          );
          return this.toReservationResponse(reservation);
        }

        if (reservation.status !== STOCK_RESERVATION_STATUS.COMMITTED) {
          throw this.reservationStatusInvalid();
        }

        // Committed stock stays reserved even after the temporary checkout expiry.
        const remainingBeforeShipment = this.unaccountedReservationQuantity(reservation);
        if (input.quantity > remainingBeforeShipment) {
          throw this.stockAdjustmentInvalid(
            "Shipment quantity exceeds the remaining committed reservation quantity.",
          );
        }

        const inventory = await repository.consumeReservedQuantity(
          item.id,
          input.quantity,
          this.now(),
        );
        if (!inventory) throw this.stockAdjustmentInvalid();

        const consumedQuantity = reservation.consumedQty + input.quantity;
        const nextStatus =
          consumedQuantity + reservation.releasedQty === reservation.qty
            ? STOCK_RESERVATION_STATUS.CONSUMED
            : STOCK_RESERVATION_STATUS.COMMITTED;
        const updated = await repository.updateReservationConsumption(
          reservation.id,
          consumedQuantity,
          nextStatus,
          this.now(),
        );
        if (!updated) throw this.reservationNotFound();

        const movement = await repository.createMovement({
          inventoryItemId: item.id,
          movementType: STOCK_MOVEMENT_TYPE.SHIP,
          quantityDelta: -input.quantity,
          sourceType: INVENTORY_SOURCE_TYPE.SHIPMENT,
          sourceId: input.sourceId,
          idempotencyKey: movementKey,
          actorUserId: context.actorId,
          occurredAt: this.now(),
        });

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.SHIPPED,
          entityType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          entityId: reservation.id,
          sellerId: item.sellerId,
          requestId: context.requestId,
          before: this.toReservationResponse(reservation),
          after: this.toReservationResponse(updated),
          metadata: {
            inventoryItemId: item.id,
            movementId: movement.id,
            shipmentSourceId: input.sourceId,
            sourceKey: input.sourceKey,
          },
        });
        await OutboxService.using(tx).enqueue({
          eventType: INVENTORY_OUTBOX_EVENT.SHIPPED,
          aggregateType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
          aggregateId: reservation.id,
          payload: {
            reservationId: reservation.id,
            inventoryItemId: item.id,
            sellerId: item.sellerId,
            storeId: item.storeId,
            variantId: item.variantId,
            shipmentSourceId: input.sourceId,
            quantity: input.quantity,
            consumedQuantity: updated.consumedQty,
            remainingQuantity: this.remainingReservationQuantity(updated),
            reservationStatus: updated.status,
            onHandQty: inventory.onHandQty,
            reservedQty: inventory.reservedQty,
            availableQty: this.availableQuantity(inventory),
          },
        });
        return this.toReservationResponse(updated);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Restocks physical on-hand quantity exactly once for one trusted Module 14 Return Item. */
  async restockStock(
    context: RequestContext,
    input: RestockStockInput,
  ): Promise<StockMovementResponse> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw inventoryError(ERROR_CODE.FORBIDDEN, "Internal Return Inventory access is required.", 403);
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > INVENTORY_LIMITS.MAX_QUANTITY) {
      throw this.stockAdjustmentInvalid("Restock quantity must be a positive supported integer.");
    }
    const sourceKey = input.sourceKey.trim();
    if (!sourceKey) {
      throw inventoryError(ERROR_CODE.VALIDATION_FAILED, "Restock source key is required.", 422);
    }
    const movementKey = this.movementKey("restock", sourceKey);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new InventoryRepository(tx);
        const item = await repository.findInventoryItemByVariantForUpdate(input.variantId);
        if (!item) throw this.inventoryNotFound();
        if (item.sellerId !== input.sellerId || item.storeId !== input.storeId) {
          throw this.stockAdjustmentInvalid("Return restock ownership does not match Inventory.");
        }

        const duplicate = await repository.findMovementByIdempotencyKey(movementKey);
        if (duplicate) {
          this.assertMovementMatches(
            duplicate,
            item.id,
            STOCK_MOVEMENT_TYPE.RESTOCK,
            input.quantity,
            INVENTORY_SOURCE_TYPE.RETURN,
            input.sourceId,
          );
          return this.toMovementResponse(duplicate);
        }

        const updated = await repository.increaseOnHandQuantity(item.id, input.quantity, this.now());
        if (!updated) throw this.inventoryNotFound();
        const movement = await repository.createMovement({
          inventoryItemId: item.id,
          movementType: STOCK_MOVEMENT_TYPE.RESTOCK,
          quantityDelta: input.quantity,
          sourceType: INVENTORY_SOURCE_TYPE.RETURN,
          sourceId: input.sourceId,
          idempotencyKey: movementKey,
          actorUserId: context.actorId,
          occurredAt: this.now(),
        });

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: INVENTORY_AUDIT_ACTION.RESTOCKED,
          entityType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
          entityId: item.id,
          sellerId: item.sellerId,
          requestId: context.requestId,
          before: this.toInventoryResponse(item),
          after: this.toInventoryResponse(updated),
          metadata: {
            movementId: movement.id,
            returnItemId: input.sourceId,
            sourceKey,
          },
        });
        await OutboxService.using(tx).enqueue({
          eventType: INVENTORY_OUTBOX_EVENT.RESTOCKED,
          aggregateType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
          aggregateId: item.id,
          payload: {
            inventoryItemId: item.id,
            sellerId: item.sellerId,
            storeId: item.storeId,
            variantId: item.variantId,
            returnItemId: input.sourceId,
            quantity: input.quantity,
            onHandQty: updated.onHandQty,
            reservedQty: updated.reservedQty,
            availableQty: this.availableQuantity(updated),
          },
        });

        return this.toMovementResponse(movement);
      });
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  /** Returns exact authoritative available quantities for trusted Checkout validation. */
  async getCheckoutAvailability(
    requests: CheckoutInventoryRequest[],
  ): Promise<CheckoutInventoryAvailability[]> {
    const requestedByVariant = new Map<string, number>();

    for (const request of requests) {
      if (
        !Number.isInteger(request.quantity) ||
        request.quantity <= 0 ||
        request.quantity > INVENTORY_LIMITS.MAX_QUANTITY
      ) {
        throw inventoryError(
          ERROR_CODE.INVALID_REQUEST,
          "Checkout stock quantity must be a positive supported integer.",
          422,
        );
      }

      const combinedQuantity =
        (requestedByVariant.get(request.variantId) ?? 0) + request.quantity;
      if (combinedQuantity > INVENTORY_LIMITS.MAX_QUANTITY) {
        throw inventoryError(
          ERROR_CODE.INVALID_REQUEST,
          "Checkout stock quantity exceeds the supported limit.",
          422,
        );
      }
      requestedByVariant.set(request.variantId, combinedQuantity);
    }

    const rows = await this.repository.listAvailabilityByVariantIds([
      ...requestedByVariant.keys(),
    ]);
    const availableByVariant = new Map(
      rows.map((row) => [row.variantId, row.onHandQty - row.reservedQty]),
    );

    return [...requestedByVariant.entries()]
      .sort(([leftVariantId], [rightVariantId]) =>
        leftVariantId.localeCompare(rightVariantId),
      )
      .map(([variantId, requestedQuantity]) => {
        const availableQuantity = Math.max(0, availableByVariant.get(variantId) ?? 0);
        return {
          variantId,
          requestedQuantity,
          availableQuantity,
          sufficient: availableQuantity >= requestedQuantity,
        };
      });
  }

  /** Returns one public-safe availability bit per requested variant without exposing stock quantities. */
  async getPublicVariantAvailability(variantIds: string[]): Promise<Map<string, boolean>> {
    const uniqueVariantIds = [...new Set(variantIds)];
    const rows = await this.repository.listAvailabilityByVariantIds(uniqueVariantIds);
    const availableByVariant = new Map(uniqueVariantIds.map((variantId) => [variantId, false]));

    for (const row of rows) {
      availableByVariant.set(row.variantId, row.onHandQty - row.reservedQty > 0);
    }
    return availableByVariant;
  }

  /** Returns a public-safe availability aggregate for trusted downstream Search synchronization. */
  async hasAvailableStockForVariants(variantIds: string[]): Promise<boolean> {
    return this.repository.hasAvailableStockForVariants(variantIds);
  }

  /** Resolves seller IDs and active stores where one Inventory permission is effective in the request context. */
  private resolveSellerScope(
    context: RequestContext,
    permission: PermissionCode,
  ): InventorySellerScope {
    const sellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId) && permissions.has(permission),
      )
      .map(([sellerId]) => sellerId);
    const storeIds = [...context.storeIds];

    if (sellerIds.length === 0 || storeIds.length === 0) {
      throw inventoryError(ERROR_CODE.FORBIDDEN, "Inventory access is not allowed.", 403);
    }
    return { sellerIds, storeIds };
  }

  /** Rejects an explicit store filter that is outside the server-derived active seller store scope. */
  private assertRequestedStoreInScope(
    storeId: string | undefined,
    scope: InventorySellerScope,
  ): void {
    if (storeId && !scope.storeIds.includes(storeId)) {
      throw inventoryError(ERROR_CODE.FORBIDDEN, "Inventory access is not allowed.", 403);
    }
  }

  /** Creates a zero-balance row for a valid owned variant or returns the existing locked seller-scoped row. */
  private async ensureSellerInventoryItem(
    repository: InventoryRepository,
    context: RequestContext,
    scope: InventorySellerScope,
    variantId: string,
    permission: PermissionCode,
  ): Promise<InventoryItemRow> {
    const existing = await repository.findInventoryItemByVariantInSellerScopeForUpdate(
      variantId,
      scope,
    );
    if (existing) return existing;

    let productScope: { variantId: string; productId: string; sellerId: string; storeId: string };
    try {
      productScope = await this.products.resolveVariantSellerStoreForCommand(
        context,
        variantId,
        permission,
      );
    } catch (error) {
      if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404)) {
        throw this.inventoryNotFound();
      }
      throw error;
    }

    await repository.createInventoryItemIfMissing({
      sellerId: productScope.sellerId,
      storeId: productScope.storeId,
      variantId,
    });
    const created = await repository.findInventoryItemByVariantInSellerScopeForUpdate(
      variantId,
      scope,
    );
    if (!created) throw this.inventoryNotFound();
    return created;
  }

  /** Requires a real authenticated actor ID for seller-initiated manual Inventory writes. */
  private requireActorId(context: RequestContext): string {
    if (!context.actorId) {
      throw inventoryError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
    return context.actorId;
  }

  /** Returns current available quantity from the authoritative persisted on-hand and reserved balances. */
  private availableQuantity(item: InventoryItemRow): number {
    return item.onHandQty - item.reservedQty;
  }

  /** Returns true only when one Inventory row currently meets its configured low-stock threshold. */
  private isLowStock(item: InventoryItemRow): boolean {
    return item.reorderLevel !== null && this.availableQuantity(item) <= item.reorderLevel;
  }

  /** Expires one reservation only when it is still an uncommitted hold after row locking. */
  private async expireReservationIfStillEligible(
    reservationId: string,
    now: Date,
  ): Promise<boolean> {
    return this.transactionRunner(async (tx) => {
      const repository = new InventoryRepository(tx);
      const reservation = await repository.findReservationByIdForUpdate(reservationId);

      // A checkout/order transition may have committed or released the reservation after the sweep query.
      if (
        !reservation ||
        reservation.status !== STOCK_RESERVATION_STATUS.RESERVED ||
        reservation.expiresAt.getTime() > now.getTime()
      ) {
        return false;
      }

      await this.releaseLockedReservation(
        tx,
        repository,
        this.createExpiryMaintenanceContext(reservation.id),
        reservation,
        reservation.orderAttemptId
          ? `checkout-expire:${reservation.orderAttemptId}:${reservation.variantId}`
          : `reservation-expiry:${reservation.id}`,
        now,
      );
      return true;
    });
  }

  /** Applies the single shared reservation-release transition used by explicit and expiry-driven releases. */
  private async releaseLockedReservation(
    tx: DatabaseTransaction,
    repository: InventoryRepository,
    context: RequestContext,
    reservation: StockReservationRow,
    sourceKey: string,
    now: Date,
  ): Promise<StockReservationResponse> {
    const movementKey = this.movementKey("release", sourceKey);
    const item = await repository.findInventoryItemByVariantForUpdate(reservation.variantId);
    if (!item) throw this.inventoryNotFound();

    const remainingQuantity = this.unaccountedReservationQuantity(reservation);
    const duplicate = await repository.findMovementByIdempotencyKey(movementKey);
    if (duplicate) {
      this.assertMovementMatches(
        duplicate,
        item.id,
        STOCK_MOVEMENT_TYPE.RELEASE,
        duplicate.quantityDelta,
        INVENTORY_SOURCE_TYPE.RESERVATION_RELEASE,
        reservation.id,
      );
      if (duplicate.quantityDelta >= 0) throw this.duplicateStockSource();
      return this.toReservationResponse(reservation);
    }

    if (
      reservation.status === STOCK_RESERVATION_STATUS.RELEASED ||
      reservation.status === STOCK_RESERVATION_STATUS.EXPIRED
    ) {
      return this.toReservationResponse(reservation);
    }
    if (reservation.status === STOCK_RESERVATION_STATUS.CONSUMED || remainingQuantity <= 0) {
      throw this.reservationStatusInvalid();
    }

    const inventory = await repository.decreaseReservedQuantity(
      item.id,
      remainingQuantity,
      now,
    );
    if (!inventory) throw this.stockAdjustmentInvalid();

    const nextStatus =
      reservation.status === STOCK_RESERVATION_STATUS.RESERVED &&
      reservation.expiresAt.getTime() <= now.getTime()
        ? STOCK_RESERVATION_STATUS.EXPIRED
        : STOCK_RESERVATION_STATUS.RELEASED;
    const updated = await repository.updateReservationReleaseAccounting(
      reservation.id,
      reservation.releasedQty + remainingQuantity,
      nextStatus,
      now,
    );
    if (!updated) throw this.reservationNotFound();

    const movement = await repository.createMovement({
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPE.RELEASE,
      quantityDelta: -remainingQuantity,
      sourceType: INVENTORY_SOURCE_TYPE.RESERVATION_RELEASE,
      sourceId: reservation.id,
      idempotencyKey: movementKey,
      actorUserId: context.actorId,
      occurredAt: now,
    });

    await AuditService.using(tx).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: INVENTORY_AUDIT_ACTION.RESERVATION_RELEASED,
      entityType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
      entityId: reservation.id,
      sellerId: item.sellerId,
      requestId: context.requestId,
      before: this.toReservationResponse(reservation),
      after: this.toReservationResponse(updated),
      metadata: { inventoryItemId: item.id, movementId: movement.id, sourceKey },
    });
    await OutboxService.using(tx).enqueue({
      eventType: INVENTORY_OUTBOX_EVENT.RESERVATION_RELEASED,
      aggregateType: INVENTORY_RESOURCE_TYPE.STOCK_RESERVATION,
      aggregateId: reservation.id,
      payload: {
        reservationId: reservation.id,
        inventoryItemId: item.id,
        sellerId: item.sellerId,
        storeId: item.storeId,
        variantId: item.variantId,
        quantity: remainingQuantity,
        consumedQuantity: reservation.consumedQty,
        status: updated.status,
        availableQty: this.availableQuantity(inventory),
      },
    });

    return this.toReservationResponse(updated);
  }

  /** Builds the system request context recorded for one automatic reservation-expiry transition. */
  private createExpiryMaintenanceContext(reservationId: string): RequestContext {
    return {
      requestId: `inventory-expiry:${reservationId}`,
      actorId: null,
      actorType: ACTOR_TYPE.SYSTEM,
      permissions: new Set(),
      sellerIds: new Set(),
      storeIds: new Set(),
      sellerPermissions: new Map(),
      sessionId: null,
    };
  }

  /** Emits low-stock only on a transition from not-low to low to avoid noisy duplicate alerts. */
  private async enqueueLowStockIfEntered(
    outbox: OutboxService,
    before: InventoryItemRow,
    after: InventoryItemRow,
  ): Promise<void> {
    if (this.isLowStock(before) || !this.isLowStock(after)) return;

    await outbox.enqueue({
      eventType: INVENTORY_OUTBOX_EVENT.LOW_STOCK,
      aggregateType: INVENTORY_RESOURCE_TYPE.INVENTORY_ITEM,
      aggregateId: after.id,
      payload: {
        inventoryItemId: after.id,
        sellerId: after.sellerId,
        storeId: after.storeId,
        variantId: after.variantId,
        availableQty: this.availableQuantity(after),
        reorderLevel: after.reorderLevel,
      },
    });
  }

  /** Creates a bounded namespaced movement idempotency key, hashing unusually long caller keys. */
  private movementKey(prefix: string, sourceKey: string): string {
    const value = `${prefix}:${sourceKey}`;
    if (value.length <= INVENTORY_LIMITS.SOURCE_KEY_MAX_LENGTH) return value;
    const digest = createHash("sha256").update(sourceKey).digest("hex");
    return `${prefix}:${digest}`;
  }

  /** Confirms an existing reservation represents the exact same reserve command before treating it as a retry. */
  private assertReservationMatchesReserve(
    reservation: StockReservationRow,
    input: ReserveStockInput,
    expiresAt: Date,
  ): void {
    const matches =
      reservation.variantId === input.variantId &&
      reservation.customerUserId === input.customerUserId &&
      reservation.orderAttemptId === (input.orderAttemptId ?? null) &&
      reservation.qty === input.quantity &&
      reservation.expiresAt.getTime() === expiresAt.getTime();
    if (!matches) throw this.duplicateStockSource();
  }

  /** Confirms one existing immutable movement exactly matches the retried command using the same source key. */
  private assertMovementMatches(
    movement: StockMovementRow,
    inventoryItemId: string,
    movementType: StockMovementRow["movementType"],
    quantityDelta: number,
    sourceType: string,
    sourceId: string | null,
  ): void {
    const matches =
      movement.inventoryItemId === inventoryItemId &&
      movement.movementType === movementType &&
      movement.quantityDelta === quantityDelta &&
      movement.sourceType === sourceType &&
      movement.sourceId === sourceId;
    if (!matches) throw this.duplicateStockSource();
  }

  /** Converts one Inventory list projection into the seller management response contract. */
  private toSellerInventoryListItemResponse(
    row: SellerInventoryListRow,
  ): SellerInventoryListItemResponse {
    return {
      ...this.toInventoryResponse(row.inventory),
      productId: row.productId,
      productName: row.productName,
      productSlug: row.productSlug,
      variantSku: row.variantSku,
      variantTitle: row.variantTitle,
      variantStatus: row.variantStatus as SellerInventoryListItemResponse["variantStatus"],
      variantPrice: row.variantPrice,
      variantCurrency: row.variantCurrency,
      storeName: row.storeName,
    };
  }

  /** Converts one persisted Inventory row into the seller/admin-safe response contract. */
  private toInventoryResponse(item: InventoryItemRow): InventoryItemResponse {
    return {
      id: item.id,
      sellerId: item.sellerId,
      storeId: item.storeId,
      variantId: item.variantId,
      onHandQty: item.onHandQty,
      reservedQty: item.reservedQty,
      availableQty: this.availableQuantity(item),
      reorderLevel: item.reorderLevel,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /** Converts one immutable movement row into the seller/admin-safe response contract. */
  private toMovementResponse(movement: StockMovementRow): StockMovementResponse {
    return {
      id: movement.id,
      inventoryItemId: movement.inventoryItemId,
      movementType: movement.movementType as StockMovementResponse["movementType"],
      quantityDelta: movement.quantityDelta,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      occurredAt: movement.occurredAt.toISOString(),
      actorUserId: movement.actorUserId,
    };
  }

  /** Calculates quantity not yet consumed or released from the original reservation. */
  private unaccountedReservationQuantity(reservation: StockReservationRow): number {
    return reservation.qty - reservation.consumedQty - reservation.releasedQty;
  }

  /** Calculates quantity still actively reserved for a later ship/release command. */
  private remainingReservationQuantity(reservation: StockReservationRow): number {
    if (
      reservation.status === STOCK_RESERVATION_STATUS.RELEASED ||
      reservation.status === STOCK_RESERVATION_STATUS.EXPIRED ||
      reservation.status === STOCK_RESERVATION_STATUS.CONSUMED
    ) {
      return 0;
    }

    return this.unaccountedReservationQuantity(reservation);
  }

  /** Converts one persisted reservation into the trusted internal response contract. */
  private toReservationResponse(reservation: StockReservationRow): StockReservationResponse {
    return {
      id: reservation.id,
      variantId: reservation.variantId,
      customerUserId: reservation.customerUserId,
      orderAttemptId: reservation.orderAttemptId,
      quantity: reservation.qty,
      consumedQuantity: reservation.consumedQty,
      remainingQuantity: this.remainingReservationQuantity(reservation),
      status: reservation.status as StockReservationResponse["status"],
      expiresAt: reservation.expiresAt.toISOString(),
      sourceKey: reservation.sourceKey,
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
    };
  }

  /** Maps database constraint failures to stable Inventory/API errors without leaking SQL details. */
  private rethrowDatabaseError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const code = databaseErrorCode(error);
    if (code === "23505") throw this.duplicateStockSource();
    if (code === "23514") throw this.stockAdjustmentInvalid();
    if (code === "23503") {
      throw inventoryError(ERROR_CODE.INVALID_REQUEST, "The stock command references invalid data.", 422);
    }
    throw error;
  }

  /** Creates the stable not-found error for Inventory rows that are missing or outside allowed seller scope. */
  private inventoryNotFound(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.INVENTORY_NOT_FOUND,
      "Inventory was not found.",
      404,
    );
  }

  /** Creates the stable insufficient-stock error used by retry-safe reservation commands. */
  private insufficientStock(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK,
      "The requested quantity is not available.",
      409,
    );
  }

  /** Creates the stable invalid-adjustment error for quantity/state changes that would break stock invariants. */
  private stockAdjustmentInvalid(
    message = "The stock change would violate Inventory quantity rules.",
  ): AppError {
    return inventoryError(INVENTORY_ERROR_CODE.STOCK_ADJUSTMENT_INVALID, message, 409);
  }

  /** Creates the stable duplicate-source error for conflicting stock command retries. */
  private duplicateStockSource(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.DUPLICATE_STOCK_SOURCE,
      "This stock source key has already been used for a different command.",
      409,
    );
  }

  /** Creates the stable reservation not-found error without exposing unrelated Inventory resources. */
  private reservationNotFound(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_NOT_FOUND,
      "Stock reservation was not found.",
      404,
    );
  }

  /** Creates the stable reservation-state error for a disallowed lifecycle transition. */
  private reservationStatusInvalid(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_STATUS_INVALID,
      "The stock reservation cannot perform this transition from its current status.",
      409,
    );
  }

  /** Creates the stable reservation-expired error for commands that require a still-live reservation. */
  private reservationExpired(): AppError {
    return inventoryError(
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_EXPIRED,
      "The stock reservation has expired.",
      409,
    );
  }
}
