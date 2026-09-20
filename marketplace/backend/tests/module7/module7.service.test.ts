import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  INVENTORY_ERROR_CODE,
  INVENTORY_PERMISSION,
} from "../../src/modules/inventory/inventory.constants.js";
import { InventoryRepository } from "../../src/modules/inventory/inventory.repository.js";
import { InventoryService } from "../../src/modules/inventory/inventory.service.js";

/** Builds one seller request context with explicit seller/store-scoped Inventory permissions. */
function sellerContext(
  permissions: readonly PermissionCode[],
  sellerId = randomUUID(),
  storeId = randomUUID(),
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(permissions),
    sellerIds: new Set([sellerId]),
    storeIds: new Set([storeId]),
    sellerPermissions: new Map([[sellerId, new Set(permissions)]]),
    sessionId: randomUUID(),
  };
}

/** Creates a persistence-shaped Inventory row for read-only service mapping tests. */
function inventoryRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: randomUUID(),
    sellerId: randomUUID(),
    storeId: randomUUID(),
    variantId: randomUUID(),
    onHandQty: 12,
    reservedQty: 4,
    reorderLevel: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Creates the minimum Inventory repository test double needed by read/pre-transaction guard tests. */
function repositoryStub(
  overrides: Partial<Record<keyof InventoryRepository, unknown>> = {},
): InventoryRepository {
  return {
    listSellerInventory: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findInventoryItemByVariantInSellerScope: vi.fn().mockResolvedValue(null),
    listMovementsByVariantInSellerScope: vi
      .fn()
      .mockResolvedValue({ items: [], totalItems: 0 }),
    ...overrides,
  } as unknown as InventoryRepository;
}

describe("Module 7 service authorization and boundary guards", () => {
  it("maps persisted balances to the authoritative available quantity", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const row = inventoryRow({ sellerId, storeId, onHandQty: 12, reservedQty: 4 });
    const repository = repositoryStub({
      listSellerInventory: vi.fn().mockResolvedValue({
        items: [{
          inventory: row,
          productId: randomUUID(),
          productName: "Inventory Product",
          productSlug: "inventory-product",
          variantSku: "INV-001",
          variantTitle: "Default",
          variantStatus: "active",
          variantPrice: "29.99",
          variantCurrency: "USD",
          storeName: "Seller Store",
        }],
        totalItems: 1,
      }),
    });
    const service = new InventoryService({ repository });

    const result = await service.listSellerInventory(
      sellerContext([INVENTORY_PERMISSION.READ], sellerId, storeId),
      { page: 1, pageSize: 20 },
    );

    expect(result.items[0]).toMatchObject({
      productName: "Inventory Product",
      variantSku: "INV-001",
      storeName: "Seller Store",
      onHandQty: 12,
      reservedQty: 4,
      availableQty: 8,
    });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
  });

  it("rejects seller Inventory reads when seller-scoped permission is absent", async () => {
    const repository = repositoryStub();
    const service = new InventoryService({ repository });

    await expect(
      service.listSellerInventory(sellerContext([]), { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repository.listSellerInventory).not.toHaveBeenCalled();
  });

  it("rejects an explicit store filter outside the server-derived seller store scope", async () => {
    const repository = repositoryStub();
    const service = new InventoryService({ repository });

    await expect(
      service.listSellerInventory(sellerContext([INVENTORY_PERMISSION.READ]), {
        page: 1,
        pageSize: 20,
        storeId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repository.listSellerInventory).not.toHaveBeenCalled();
  });

  it("rejects an already expired reserve command before opening a transaction", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const now = new Date("2026-09-07T00:00:00.000Z");
    const service = new InventoryService({
      transactionRunner,
      now: () => now,
    });

    await expect(
      service.reserveStock(
        {
          requestId: randomUUID(),
          actorId: null,
          actorType: ACTOR_TYPE.SYSTEM,
          permissions: new Set(),
          sellerIds: new Set(),
          storeIds: new Set(),
          sellerPermissions: new Map(),
          sessionId: null,
        },
        {
          variantId: randomUUID(),
          customerUserId: randomUUID(),
          quantity: 1,
          expiresAt: new Date(now.getTime() - 1).toISOString(),
          sourceKey: "expired-reserve",
        },
      ),
    ).rejects.toMatchObject({
      code: INVENTORY_ERROR_CODE.STOCK_RESERVATION_EXPIRED,
      statusCode: 409,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });
});
