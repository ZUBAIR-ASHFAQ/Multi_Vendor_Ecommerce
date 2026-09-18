import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InventoryItemRow,
  StockMovementRow,
  StockReservationRow,
} from "../../src/database/schema/inventory.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import { AuditService } from "../../src/common/audit/audit.service.js";
import { OutboxService } from "../../src/common/outbox/outbox.service.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  STOCK_MOVEMENT_TYPE,
  STOCK_RESERVATION_STATUS,
} from "../../src/modules/inventory/inventory.constants.js";
import { InventoryRepository } from "../../src/modules/inventory/inventory.repository.js";
import { InventoryService } from "../../src/modules/inventory/inventory.service.js";
import { PRODUCT_STATUS } from "../../src/modules/products/products.constants.js";
import { ProductsRepository } from "../../src/modules/products/products.repository.js";
import { ProductsService } from "../../src/modules/products/products.service.js";

/** Builds the minimal system context used by trusted cross-module Inventory commands. */
function systemContext(): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates a narrow Product repository double for immutable Checkout/Order snapshot resolution. */
function productRepositoryStub(
  overrides: Partial<Record<keyof ProductsRepository, unknown>>,
): ProductsRepository {
  return {
    findVariantSellerStoreScope: vi.fn(),
    findPublicProductById: vi.fn(),
    findVariantByIdInProduct: vi.fn(),
    ...overrides,
  } as unknown as ProductsRepository;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Module 11 Pass 2 prerequisite service boundaries", () => {
  it("returns SKU, Product name, and variant title snapshots from the trusted Product resolver", async () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const categoryId = randomUUID();
    const repository = productRepositoryStub({
      findVariantSellerStoreScope: vi.fn().mockResolvedValue({
        variantId,
        productId,
        sellerId,
        storeId,
      }),
      findPublicProductById: vi.fn().mockResolvedValue({
        id: productId,
        sellerId,
        storeId,
        categoryId,
        name: "Immutable Product Name",
      }),
      findVariantByIdInProduct: vi.fn().mockResolvedValue({
        id: variantId,
        status: PRODUCT_STATUS.ACTIVE,
        sku: "ORDER-SKU-1",
        title: "Large",
        price: "250.0000",
        currency: "PKR",
      }),
    });

    const service = new ProductsService({ repository });

    await expect(service.resolveVariantForCheckout(variantId)).resolves.toMatchObject({
      productId,
      variantId,
      sellerId,
      storeId,
      categoryId,
      skuSnapshot: "ORDER-SKU-1",
      nameSnapshot: "Immutable Product Name",
      variantTitleSnapshot: "Large",
      unitPrice: "250.0000",
      currency: "PKR",
    });
  });

  it("partially releases only the requested reserved quantity and preserves the remaining hold", async () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    const reservationId = randomUUID();
    const variantId = randomUUID();
    const inventoryItemId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const reservation: StockReservationRow = {
      id: reservationId,
      variantId,
      customerUserId: randomUUID(),
      orderAttemptId: randomUUID(),
      qty: 5,
      consumedQty: 0,
      releasedQty: 0,
      status: STOCK_RESERVATION_STATUS.RESERVED,
      expiresAt: new Date("2026-09-12T12:20:00.000Z"),
      sourceKey: "checkout-reserve:test",
      createdAt: new Date("2026-09-12T11:55:00.000Z"),
      updatedAt: new Date("2026-09-12T11:55:00.000Z"),
    };
    const item: InventoryItemRow = {
      id: inventoryItemId,
      sellerId,
      storeId,
      variantId,
      onHandQty: 10,
      reservedQty: 5,
      reorderLevel: null,
      createdAt: now,
      updatedAt: now,
    };
    const updatedItem: InventoryItemRow = { ...item, reservedQty: 3, updatedAt: now };
    const updatedReservation: StockReservationRow = {
      ...reservation,
      releasedQty: 2,
      status: STOCK_RESERVATION_STATUS.RESERVED,
      updatedAt: now,
    };
    const movement: StockMovementRow = {
      id: randomUUID(),
      inventoryItemId,
      movementType: STOCK_MOVEMENT_TYPE.RELEASE,
      quantityDelta: -2,
      sourceType: "reservation_release",
      sourceId: reservationId,
      idempotencyKey: "release:order-cancel:test",
      occurredAt: now,
      actorUserId: null,
    };

    vi.spyOn(InventoryRepository.prototype, "findReservationByIdForUpdate").mockResolvedValue(
      reservation,
    );
    vi.spyOn(InventoryRepository.prototype, "findInventoryItemByVariantForUpdate").mockResolvedValue(
      item,
    );
    vi.spyOn(InventoryRepository.prototype, "findMovementByIdempotencyKey").mockResolvedValue(null);
    vi.spyOn(InventoryRepository.prototype, "decreaseReservedQuantity").mockResolvedValue(updatedItem);
    const updateRelease = vi
      .spyOn(InventoryRepository.prototype, "updateReservationReleaseAccounting")
      .mockResolvedValue(updatedReservation);
    vi.spyOn(InventoryRepository.prototype, "createMovement").mockResolvedValue(movement);

    vi.spyOn(AuditService, "using").mockReturnValue({
      record: vi.fn().mockResolvedValue(randomUUID()),
    } as unknown as AuditService);
    vi.spyOn(OutboxService, "using").mockReturnValue({
      enqueue: vi.fn().mockResolvedValue(randomUUID()),
    } as unknown as OutboxService);

    const transaction = {} as DatabaseTransaction;
    const service = new InventoryService({
      transactionRunner: async (work) => work(transaction),
      now: () => now,
    });

    const result = await service.releaseReservationQuantity(systemContext(), {
      reservationId,
      quantity: 2,
      sourceKey: "order-cancel:test",
    });

    expect(updateRelease).toHaveBeenCalledWith(
      reservationId,
      2,
      STOCK_RESERVATION_STATUS.RESERVED,
      now,
    );
    expect(result.remainingQuantity).toBe(3);
    expect(result.status).toBe(STOCK_RESERVATION_STATUS.RESERVED);
  });
});
