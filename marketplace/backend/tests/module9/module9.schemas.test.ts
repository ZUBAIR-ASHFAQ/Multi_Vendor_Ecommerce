import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { promotionsOpenApiPaths } from "../../src/modules/promotions/promotions.routes.js";
import {
  createPlatformPromotionBodySchema,
  updatePromotionBodySchema,
  validatePromotionQuerySchema,
} from "../../src/modules/promotions/promotions.schema.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Returns documented HTTP methods for one Module 9 OpenAPI path in stable order. */
function documentedMethods(pathItem: Readonly<Record<string, unknown>> | undefined): string[] {
  return Object.keys(pathItem ?? {})
    .filter((key) => HTTP_METHODS.has(key))
    .sort();
}

/** Creates one valid platform promotion request for focused Zod boundary tests. */
function validPromotionInput(): Record<string, unknown> {
  return {
    name: "Schema Promotion",
    type: "percentage",
    value: "10.0000",
    startAt: "2026-09-09T10:00:00.000Z",
    endAt: "2026-09-10T10:00:00.000Z",
    scopes: [{ scopeType: "product", scopeId: randomUUID() }],
    coupon: { code: " save10 ", maxUses: 100, maxUsesPerCustomer: 1 },
  };
}

describe("Module 9 contract schemas", () => {
  it("documents the approved promotion operations with bearer authentication", () => {
    const expected = {
      "/api/v1/admin/promotions": ["get", "post"],
      "/api/v1/admin/promotions/{id}": ["patch"],
      "/api/v1/seller/promotions": ["get", "post"],
      "/api/v1/promotions/validate": ["get"],
      "/api/v1/admin/promotions/{id}/activate": ["post"],
      "/api/v1/admin/promotions/{id}/deactivate": ["post"],
    } as const;

    expect(Object.keys(promotionsOpenApiPaths).sort()).toEqual(Object.keys(expected).sort());
    for (const [path, methods] of Object.entries(expected)) {
      const pathItem = promotionsOpenApiPaths[path as keyof typeof promotionsOpenApiPaths];
      expect(documentedMethods(pathItem as Readonly<Record<string, unknown>>)).toEqual(
        [...methods].sort(),
      );
      for (const method of methods) {
        const operation = (pathItem as unknown as Record<string, Record<string, unknown>>)[method];
        expect(operation?.security).toEqual([{ bearerAuth: [] }]);
      }
    }
  });

  it("normalizes coupon codes and rejects client-owned authority fields", () => {
    const parsed = createPlatformPromotionBodySchema.parse(validPromotionInput());
    expect(parsed.coupon?.code).toBe("SAVE10");

    expect(() =>
      createPlatformPromotionBodySchema.parse({
        ...validPromotionInput(),
        ownerType: "seller",
        sellerId: randomUUID(),
        fundingType: "seller",
        discountAmount: "999.00",
      }),
    ).toThrow();
  });

  it("rejects invalid date ranges, percentage overflow, duplicate scopes, and empty updates", () => {
    const scopeId = randomUUID();

    expect(() =>
      createPlatformPromotionBodySchema.parse({
        ...validPromotionInput(),
        startAt: "2026-09-10T10:00:00.000Z",
        endAt: "2026-09-09T10:00:00.000Z",
      }),
    ).toThrow("Promotion endAt must be later than startAt.");

    expect(() =>
      createPlatformPromotionBodySchema.parse({
        ...validPromotionInput(),
        value: "100.0001",
      }),
    ).toThrow("Percentage promotion value must not exceed 100.");

    expect(() =>
      createPlatformPromotionBodySchema.parse({
        ...validPromotionInput(),
        scopes: [
          { scopeType: "product", scopeId },
          { scopeType: "product", scopeId },
        ],
      }),
    ).toThrow("Promotion scopes must be unique.");

    expect(() => updatePromotionBodySchema.parse({})).toThrow(
      "At least one editable promotion field is required.",
    );
  });

  it("keeps coupon validation limited to normalized code while deriving customer/cart authority server-side", () => {
    expect(validatePromotionQuerySchema.parse({ code: "  welcome-10 " })).toEqual({
      code: "WELCOME-10",
    });
    expect(() =>
      validatePromotionQuerySchema.parse({
        code: "WELCOME-10",
        customerUserId: randomUUID(),
        discountAmount: "1000.00",
      }),
    ).toThrow();
  });
});
