import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { DOCUMENT_PURPOSE } from "../../src/modules/documents-audit/documents-audit.constants.js";
import {
  PRODUCT_ERROR_CODE,
  PRODUCT_PERMISSION,
  PRODUCT_PUBLICATION_STATUS,
  PRODUCT_STATUS,
} from "../../src/modules/products/products.constants.js";
import { ProductsRepository } from "../../src/modules/products/products.repository.js";
import { ProductsService } from "../../src/modules/products/products.service.js";

/** Builds one seller request context with explicit seller/store-scoped Product permissions. */
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

/** Creates a persistence-shaped Product row for read-only service mapping tests. */
function productRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: randomUUID(),
    sellerId: randomUUID(),
    storeId: randomUUID(),
    categoryId: randomUUID(),
    brandId: null,
    slug: "public-product",
    name: "Public Product",
    description: "Description",
    status: PRODUCT_STATUS.ACTIVE,
    publicationStatus: PRODUCT_PUBLICATION_STATUS.PUBLISHED,
    createdBy: randomUUID(),
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Creates a small repository test double for read and pre-transaction guard tests. */
function repositoryStub(
  overrides: Partial<Record<keyof ProductsRepository, unknown>> = {},
): ProductsRepository {
  return {
    listPublicProducts: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    listActiveVariantIdsByProductIds: vi.fn().mockResolvedValue([]),
    findPublicProductStorefrontBySlug: vi.fn().mockResolvedValue(null),
    listSellerProducts: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findProductByIdInSellerScope: vi.fn().mockResolvedValue(null),
    listVariantsByProductId: vi.fn().mockResolvedValue([]),
    listAttributeValuesByProductId: vi.fn().mockResolvedValue([]),
    listMediaByProductId: vi.fn().mockResolvedValue([]),
    listPriceHistoryByProductId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ProductsRepository;
}

describe("Module 6 service authorization and boundary guards", () => {
  it("returns public-safe Product fields without seller/private lifecycle data", async () => {
    const row = productRow();
    const thumbnailFileId = randomUUID();
    const variantId = randomUUID();
    const repository = repositoryStub({
      listPublicProducts: vi.fn().mockResolvedValue({
        items: [{
          product: row,
          minPrice: "19.99",
          maxPrice: "29.99",
          minCompareAtPrice: "24.99",
          maxCompareAtPrice: "39.99",
          currency: "USD",
          thumbnailFileId,
        }],
        totalItems: 1,
      }),
      listActiveVariantIdsByProductIds: vi.fn().mockResolvedValue([
        { productId: row.id, variantId },
      ]),
    });
    const service = new ProductsService({
      repository,
      inventory: {
        getPublicVariantAvailability: vi.fn().mockResolvedValue(new Map([[variantId, true]])),
      },
      ratings: {
        getPublishedRatingAggregates: vi.fn().mockResolvedValue(
          new Map([[row.id, { average: 4.5, count: 12 }]]),
        ),
      },
    });

    const result = await service.listPublicProducts({
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      direction: "desc",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty("sellerId");
    expect(result.items[0]).not.toHaveProperty("publicationStatus");
    expect(result.items[0]).toMatchObject({
      minPrice: "19.99",
      maxPrice: "29.99",
      minCompareAtPrice: "24.99",
      maxCompareAtPrice: "39.99",
      currency: "USD",
      ratingAvg: 4.5,
      ratingCount: 12,
      inStock: true,
      thumbnailFileId,
    });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
  });

  it("returns safe Store/Seller/category/brand context only on the public HTTP Product detail", async () => {
    const storeId = randomUUID();
    const sellerId = randomUUID();
    const categoryId = randomUUID();
    const brandId = randomUUID();
    const row = productRow({ storeId, sellerId, categoryId, brandId });
    const variantId = randomUUID();
    const repository = repositoryStub({
      findPublicProductStorefrontBySlug: vi.fn().mockResolvedValue({
        product: row,
        storeId,
        storeSlug: "seller-store",
        storeName: "Seller Store",
        storeLogoFileId: null,
        sellerId,
        sellerDisplayName: "Seller Display",
        categoryId,
        categorySlug: "electronics",
        categoryName: "Electronics",
        brandId,
        brandSlug: "acme",
        brandName: "Acme",
      }),
      listVariantsByProductId: vi.fn().mockResolvedValue([{
        id: variantId,
        productId: row.id,
        sku: "PUBLIC-1",
        title: "Default",
        price: "19.99",
        compareAtPrice: null,
        currency: "USD",
        status: PRODUCT_STATUS.ACTIVE,
        weight: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
    });
    const service = new ProductsService({
      repository,
      inventory: {
        getPublicVariantAvailability: vi.fn().mockResolvedValue(new Map([[variantId, false]])),
      },
    });

    const result = await service.getPublicProduct(row.slug);

    expect(result).toMatchObject({
      id: row.id,
      store: { id: storeId, slug: "seller-store", name: "Seller Store", seller: { id: sellerId, displayName: "Seller Display" } },
      category: { id: categoryId, slug: "electronics", name: "Electronics" },
      brand: { id: brandId, slug: "acme", name: "Acme" },
      variants: [expect.objectContaining({ id: variantId, inStock: false })],
    });
    expect(result).not.toHaveProperty("sellerId");
    expect(result).not.toHaveProperty("publicationStatus");
  });

  it("rejects seller Product reads when seller-scoped permission is absent", async () => {
    const repository = repositoryStub();
    const service = new ProductsService({ repository });

    await expect(
      service.listSellerProducts(sellerContext([]), {
        page: 1,
        pageSize: 20,
        sort: "createdAt",
        direction: "desc",
      }),
    ).rejects.toMatchObject({
      code: PRODUCT_ERROR_CODE.PRODUCT_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
    expect(repository.listSellerProducts).not.toHaveBeenCalled();
  });

  it("returns an empty seller Product list when an approved seller has no active store yet", async () => {
    const sellerId = randomUUID();
    const repository = repositoryStub();
    const service = new ProductsService({ repository });
    const context = sellerContext([PRODUCT_PERMISSION.SELLER_READ], sellerId);
    context.storeIds = new Set();

    const result = await service.listSellerProducts(context, {
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      direction: "desc",
    });

    expect(result).toEqual({
      items: [],
      meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
    expect(repository.listSellerProducts).toHaveBeenCalledWith(
      { sellerIds: [sellerId], storeIds: [] },
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it("returns the enriched seller Product management projection without changing Product lifecycle fields", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const row = productRow({ sellerId, storeId, publicationStatus: PRODUCT_PUBLICATION_STATUS.DRAFT });
    const thumbnailFileId = randomUUID();
    const repository = repositoryStub({
      listSellerProducts: vi.fn().mockResolvedValue({
        items: [{
          product: row,
          storeName: "Seller Store",
          storeSlug: "seller-store",
          storeCurrency: "USD",
          variantCount: 2,
          minPrice: "19.99",
          maxPrice: "29.99",
          priceCurrency: "USD",
          thumbnailFileId,
        }],
        totalItems: 1,
      }),
    });
    const service = new ProductsService({ repository });

    const result = await service.listSellerProducts(
      sellerContext([PRODUCT_PERMISSION.SELLER_READ], sellerId, storeId),
      { page: 1, pageSize: 20, sort: "updatedAt", direction: "desc" },
    );

    expect(result.items[0]).toMatchObject({
      id: row.id,
      publicationStatus: PRODUCT_PUBLICATION_STATUS.DRAFT,
      storeName: "Seller Store",
      storeSlug: "seller-store",
      storeCurrency: "USD",
      variantCount: 2,
      minPrice: "19.99",
      maxPrice: "29.99",
      priceCurrency: "USD",
      thumbnailFileId,
    });
  });

  it("rejects a seller list store filter outside the server-derived store scope", async () => {
    const repository = repositoryStub();
    const context = sellerContext([PRODUCT_PERMISSION.SELLER_READ]);
    const service = new ProductsService({ repository });

    await expect(
      service.listSellerProducts(context, {
        page: 1,
        pageSize: 20,
        storeId: randomUUID(),
        sort: "createdAt",
        direction: "desc",
      }),
    ).rejects.toMatchObject({
      code: PRODUCT_ERROR_CODE.PRODUCT_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
    expect(repository.listSellerProducts).not.toHaveBeenCalled();
  });

  it("rejects unsupported variant currency before opening a database transaction", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const context = sellerContext([PRODUCT_PERMISSION.SELLER_UPDATE]);
    const service = new ProductsService({
      transactionRunner,
      currencies: { isSupportedCurrency: vi.fn().mockResolvedValue(false) },
    });

    await expect(
      service.addVariant(context, randomUUID(), {
        sku: "SKU-1",
        title: "Variant",
        price: "10.00",
        currency: "EUR",
      }),
    ).rejects.toMatchObject({
      code: PRODUCT_ERROR_CODE.PRODUCT_CURRENCY_UNSUPPORTED,
      statusCode: 409,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("rejects non-image/video Product media before opening a Product transaction", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const context = sellerContext([PRODUCT_PERMISSION.SELLER_UPDATE]);
    const fileId = randomUUID();
    const documents = {
      getUsableFileForPurpose: vi.fn().mockResolvedValue({
        id: fileId,
        purpose: DOCUMENT_PURPOSE.PRODUCT_MEDIA,
        originalName: "manual.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        ownerUserId: context.actorId,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      }),
    };
    const service = new ProductsService({ transactionRunner, documents });

    await expect(
      service.linkMedia(context, randomUUID(), { fileId }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(documents.getUsableFileForPurpose).toHaveBeenCalledWith(
      context,
      fileId,
      DOCUMENT_PURPOSE.PRODUCT_MEDIA,
    );
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("rejects admin approval without the platform review permission before opening a transaction", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const service = new ProductsService({ transactionRunner });
    const context: RequestContext = {
      requestId: randomUUID(),
      actorId: randomUUID(),
      actorType: ACTOR_TYPE.PLATFORM_ADMIN,
      permissions: new Set(),
      sellerIds: new Set(),
      storeIds: new Set(),
      sellerPermissions: new Map(),
      sessionId: randomUUID(),
    };

    await expect(service.approveProduct(context, randomUUID())).rejects.toMatchObject({
      code: PRODUCT_ERROR_CODE.PRODUCT_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });
});
