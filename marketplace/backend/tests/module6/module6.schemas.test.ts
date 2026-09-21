import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PRODUCT_PUBLICATION_STATUS } from "../../src/modules/products/products.constants.js";
import { productsOpenApiPaths } from "../../src/modules/products/products.routes.js";
import {
  adminProductListQuerySchema,
  createProductBodySchema,
  createProductVariantBodySchema,
  emptyProductCommandBodySchema,
  linkProductMediaBodySchema,
  productAttributeInputSchema,
  productAttributesInputSchema,
  productPriceSchema,
  publicProductDetailResponseSchema,
  publicProductListItemResponseSchema,
  productSlugSchema,
  productWeightSchema,
  rejectProductBodySchema,
  updateProductBodySchema,
  updateProductVariantBodySchema,
} from "../../src/modules/products/products.schema.js";

/** Returns one OpenAPI operation object for a Product path/method. */
function operation(path: string, method: string): Record<string, unknown> {
  const pathItem = productsOpenApiPaths[path as keyof typeof productsOpenApiPaths] as unknown as Record<string, Record<string, unknown>>;
  return pathItem[method] ?? {};
}

describe("Module 6 Zod and OpenAPI contracts", () => {
  it("normalizes global slugs and rejects server-owned Product fields", () => {
    expect(productSlugSchema.parse("  SUMMER-SHOE  ")).toBe("summer-shoe");

    expect(() =>
      createProductBodySchema.parse({
        storeId: randomUUID(),
        categoryId: randomUUID(),
        slug: "shoe",
        name: "Shoe",
        description: "Simple Product",
        sellerId: randomUUID(),
      }),
    ).toThrow();
  });

  it("matches PostgreSQL decimal precision without allowing silent rounding", () => {
    expect(productPriceSchema.parse("9999999999999999.99")).toBe("9999999999999999.99");
    expect(() => productPriceSchema.parse("10000000000000000.00")).toThrow();
    expect(() => productPriceSchema.parse("1.001")).toThrow();

    expect(productWeightSchema.parse("123456789.123")).toBe("123456789.123");
    expect(() => productWeightSchema.parse("1234567890.123")).toThrow();
    expect(() => productWeightSchema.parse("1.0001")).toThrow();
  });

  it("requires exactly one representation per attribute and rejects duplicate attribute IDs", () => {
    const attributeId = randomUUID();
    expect(
      productAttributeInputSchema.parse({ attributeId, valueText: "Cotton" }),
    ).toEqual({ attributeId, valueText: "Cotton" });

    expect(() =>
      productAttributeInputSchema.parse({
        attributeId,
        valueText: "Cotton",
        valueNumber: "1",
      }),
    ).toThrow(/Exactly one attribute value representation/);

    expect(() =>
      productAttributesInputSchema.parse([
        { attributeId, valueText: "A" },
        { attributeId, valueText: "B" },
      ]),
    ).toThrow(/Each attribute may be supplied only once/);
  });

  it("requires non-empty update commands and keeps lifecycle fields command-owned", () => {
    expect(() => updateProductBodySchema.parse({})).toThrow();
    expect(() => updateProductVariantBodySchema.parse({})).toThrow();
    expect(() => updateProductBodySchema.parse({ publicationStatus: "published" })).toThrow();
    expect(() => createProductVariantBodySchema.parse({
      sku: "SKU-1",
      title: "Variant",
      price: "10.00",
      currency: "USD",
      productId: randomUUID(),
    })).toThrow();
  });

  it("derives Product media type server-side and accepts omitted empty command bodies", () => {
    const fileId = randomUUID();
    expect(linkProductMediaBodySchema.parse({ fileId, altText: "Front view" })).toEqual({
      fileId,
      altText: "Front view",
    });
    expect(() => linkProductMediaBodySchema.parse({ fileId, mediaType: "image" })).toThrow();
    expect(emptyProductCommandBodySchema.parse(undefined)).toEqual({});
  });

  it("defaults the admin queue to pending submissions and requires a rejection reason", () => {
    expect(adminProductListQuerySchema.parse({})).toMatchObject({
      publicationStatus: PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL,
      sort: "updatedAt",
      direction: "asc",
    });
    expect(rejectProductBodySchema.parse({ reason: "  Add a clear front image.  " })).toEqual({
      reason: "Add a clear front image.",
    });
    expect(() => rejectProductBodySchema.parse({ reason: "   " })).toThrow();
  });


  it("keeps public Product detail storefront context safe and free of seller-private lifecycle fields", () => {
    const value = publicProductDetailResponseSchema.parse({
      id: randomUUID(),
      storeId: randomUUID(),
      categoryId: randomUUID(),
      brandId: randomUUID(),
      slug: "public-detail",
      name: "Public Detail",
      description: "Public product detail",
      publishedAt: "2026-09-20T08:00:00.000Z",
      createdAt: "2026-09-20T08:00:00.000Z",
      updatedAt: "2026-09-20T08:00:00.000Z",
      store: {
        id: randomUUID(),
        slug: "seller-store",
        name: "Seller Store",
        logoFileId: null,
        seller: { id: randomUUID(), displayName: "Seller Display" },
      },
      category: { id: randomUUID(), slug: "electronics", name: "Electronics" },
      brand: { id: randomUUID(), slug: "acme", name: "Acme" },
      variants: [{
        id: randomUUID(),
        productId: randomUUID(),
        sku: "PUBLIC-1",
        title: "Default",
        price: "19.99",
        compareAtPrice: null,
        currency: "USD",
        weight: null,
        inStock: true,
        createdAt: "2026-09-20T08:00:00.000Z",
        updatedAt: "2026-09-20T08:00:00.000Z",
      }],
      attributes: [],
      media: [],
    });

    expect(value.store.name).toBe("Seller Store");
    expect(value.category.name).toBe("Electronics");
    expect(value.brand?.name).toBe("Acme");
    expect(() => publicProductDetailResponseSchema.parse({ ...value, sellerId: randomUUID() })).toThrow();
  });

  it("keeps the public Product-list card contract additive and free of seller-private fields", () => {
    const value = publicProductListItemResponseSchema.parse({
      id: randomUUID(),
      storeId: randomUUID(),
      categoryId: randomUUID(),
      brandId: null,
      slug: "public-card",
      name: "Public Card",
      description: "Public product card",
      publishedAt: "2026-09-20T08:00:00.000Z",
      createdAt: "2026-09-20T08:00:00.000Z",
      updatedAt: "2026-09-20T08:00:00.000Z",
      minPrice: "19.99",
      maxPrice: "29.99",
      minCompareAtPrice: "24.99",
      maxCompareAtPrice: "39.99",
      currency: "USD",
      ratingAvg: 4.5,
      ratingCount: 12,
      inStock: true,
      thumbnailFileId: randomUUID(),
    });

    expect(value.minPrice).toBe("19.99");
    expect(value.minCompareAtPrice).toBe("24.99");
    expect(value.maxCompareAtPrice).toBe("39.99");
    expect(value.ratingAvg).toBe(4.5);
    expect(value.ratingCount).toBe(12);
    expect(value.inStock).toBe(true);
    expect(value.thumbnailFileId).toBeTruthy();
    expect(() => publicProductListItemResponseSchema.parse({ ...value, sellerId: randomUUID() })).toThrow();
  });

  it("documents the complete Module 6 HTTP contract with standard error responses", () => {
    const expected: Record<string, string[]> = {
      "/api/v1/products": ["get"],
      "/api/v1/products/{slug}": ["get"],
      "/api/v1/seller/products": ["get", "post"],
      "/api/v1/seller/products/{id}": ["get", "patch"],
      "/api/v1/seller/products/{id}/variants": ["post"],
      "/api/v1/seller/products/{id}/variants/{variantId}": ["patch"],
      "/api/v1/seller/products/{id}/media": ["post"],
      "/api/v1/seller/products/{id}/publish": ["post"],
      "/api/v1/seller/products/{id}/unpublish": ["post"],
      "/api/v1/admin/products": ["get"],
      "/api/v1/admin/products/{id}": ["get"],
      "/api/v1/admin/products/{id}/approve": ["post"],
      "/api/v1/admin/products/{id}/reject": ["post"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      const pathItem = productsOpenApiPaths[path as keyof typeof productsOpenApiPaths] as unknown as Record<string, unknown>;
      expect(Object.keys(pathItem).sort()).toEqual(methods.sort());
    }

    const createOperation = operation("/api/v1/seller/products", "post") as {
      responses?: Record<string, unknown>;
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
    };
    expect(createOperation.responses?.["401"]).toBeTruthy();
    expect(createOperation.responses?.["403"]).toBeTruthy();
    expect(createOperation.responses?.["409"]).toBeTruthy();
    expect(createOperation.responses?.["422"]).toBeTruthy();
    expect(createOperation.requestBody?.content?.["application/json"]?.schema?.additionalProperties).toBe(false);
  });
});
