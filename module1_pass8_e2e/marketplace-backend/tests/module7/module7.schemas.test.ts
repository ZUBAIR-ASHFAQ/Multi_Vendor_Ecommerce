import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inventoryOpenApiPaths } from "../../src/modules/inventory/inventory.routes.js";
import {
  adjustStockBodySchema,
  inventoryNonNegativeQuantitySchema,
  inventoryPositiveQuantitySchema,
  inventoryQuantityDeltaSchema,
  inventorySourceKeySchema,
  reserveStockBodySchema,
  sellerInventoryListQuerySchema,
  shipStockBodySchema,
  stockReservationResponseSchema,
  updateReorderLevelBodySchema,
} from "../../src/modules/inventory/inventory.schema.js";

/** Returns one OpenAPI operation object for an Inventory path and HTTP method. */
function operation(path: string, method: string): Record<string, unknown> {
  const pathItem = inventoryOpenApiPaths[
    path as keyof typeof inventoryOpenApiPaths
  ] as unknown as Record<string, Record<string, unknown>>;
  return pathItem[method] ?? {};
}

describe("Module 7 Zod and OpenAPI contracts", () => {
  it("bounds stock quantities and rejects zero manual adjustments", () => {
    expect(inventoryNonNegativeQuantitySchema.parse(0)).toBe(0);
    expect(inventoryPositiveQuantitySchema.parse(1)).toBe(1);
    expect(inventoryQuantityDeltaSchema.parse(-5)).toBe(-5);
    expect(() => inventoryNonNegativeQuantitySchema.parse(-1)).toThrow();
    expect(() => inventoryPositiveQuantitySchema.parse(0)).toThrow();
    expect(() => inventoryQuantityDeltaSchema.parse(0)).toThrow(/must not be zero/i);
  });

  it("normalizes source keys and keeps authoritative ownership and balances out of write bodies", () => {
    expect(inventorySourceKeySchema.parse("  checkout-attempt-1  ")).toBe(
      "checkout-attempt-1",
    );

    expect(() =>
      adjustStockBodySchema.parse({
        quantityDelta: 4,
        sellerId: randomUUID(),
        onHandQty: 100,
      }),
    ).toThrow();
    expect(() =>
      updateReorderLevelBodySchema.parse({
        reorderLevel: 5,
        storeId: randomUUID(),
      }),
    ).toThrow();
  });

  it("parses only literal low-stock query booleans and reuses shared pagination fields", () => {
    expect(
      sellerInventoryListQuerySchema.parse({ page: "2", pageSize: "10", lowStock: "true" }),
    ).toMatchObject({ page: 2, pageSize: 10, lowStock: true });
    expect(
      sellerInventoryListQuerySchema.parse({ page: "1", pageSize: "20", lowStock: "false" }),
    ).toMatchObject({ page: 1, pageSize: 20, lowStock: false });
    expect(() => sellerInventoryListQuerySchema.parse({ lowStock: "1" })).toThrow();
  });

  it("keeps reserve and shipment commands strict and server-controlled", () => {
    const reservationId = randomUUID();
    const reserve = {
      variantId: randomUUID(),
      customerUserId: randomUUID(),
      quantity: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceKey: "reserve-1",
    };

    expect(reserveStockBodySchema.parse(reserve)).toEqual(reserve);
    expect(() => reserveStockBodySchema.parse({ ...reserve, sellerId: randomUUID() })).toThrow();
    expect(
      shipStockBodySchema.parse({
        reservationId,
        quantity: 2,
        sourceId: randomUUID(),
        sourceKey: "shipment-1",
      }),
    ).toMatchObject({ reservationId, quantity: 2, sourceKey: "shipment-1" });
  });

  it("returns partial reservation progress to trusted fulfillment callers", () => {
    const now = new Date();
    const response = {
      id: randomUUID(),
      variantId: randomUUID(),
      customerUserId: randomUUID(),
      orderAttemptId: null,
      quantity: 5,
      consumedQuantity: 2,
      remainingQuantity: 3,
      status: "committed",
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      sourceKey: "reservation-progress",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    expect(stockReservationResponseSchema.parse(response)).toEqual(response);
  });

  it("documents exactly the required Module 7 HTTP surface and internal security", () => {
    const expected: Record<string, string[]> = {
      "/api/v1/seller/inventory": ["get"],
      "/api/v1/seller/inventory/{variantId}/movements": ["get"],
      "/api/v1/seller/inventory/{variantId}/adjust": ["post"],
      "/api/v1/seller/inventory/{variantId}/reorder-level": ["patch"],
      "/api/v1/internal/inventory/reserve": ["post"],
      "/api/v1/internal/inventory/release": ["post"],
      "/api/v1/internal/inventory/ship": ["post"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      const pathItem = inventoryOpenApiPaths[
        path as keyof typeof inventoryOpenApiPaths
      ] as unknown as Record<string, unknown>;
      expect(Object.keys(pathItem).sort()).toEqual(methods.sort());
    }
    expect(inventoryOpenApiPaths).not.toHaveProperty("/api/v1/internal/inventory/commit");

    const reserveOperation = operation("/api/v1/internal/inventory/reserve", "post") as {
      security?: Array<Record<string, unknown>>;
      responses?: Record<string, unknown>;
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
    };
    expect(reserveOperation.security).toEqual([{ internalApiKey: [] }]);
    expect(reserveOperation.responses?.["401"]).toBeTruthy();
    expect(reserveOperation.responses?.["409"]).toBeTruthy();
    expect(reserveOperation.responses?.["422"]).toBeTruthy();
    expect(
      reserveOperation.requestBody?.content?.["application/json"]?.schema?.additionalProperties,
    ).toBe(false);
  });
});
