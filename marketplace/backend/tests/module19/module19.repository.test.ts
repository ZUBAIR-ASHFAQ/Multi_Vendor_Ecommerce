import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase } from "../../src/database/db.js";
import { SearchDiscoveryRepository } from "../../src/modules/search-discovery/search-discovery.repository.js";
import { searchProductsQuerySchema } from "../../src/modules/search-discovery/search-discovery.schema.js";
import {
  bearer,
  createAttributeViaHttp,
  createBrandViaHttp,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createPublishedSearchProduct,
  createVariantViaHttp,
  loginUser,
  resetModule19Tables,
} from "./module19.test-helpers.js";

beforeEach(async () => {
  await resetModule19Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 19 PostgreSQL Search repository", () => {
  it("uses FTS/trigram while stale documents still obey live public Product visibility", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SearchRepoVisibility");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module19-audio-${randomUUID()}`,
      name: "Audio",
    });
    const published = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      label: "WirelessHeadphones",
      compareAtPrice: "125.00",
    });
    const draft = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: `module19-draft-${randomUUID()}`,
      name: "Private Headphones",
      description: "Must not leak through Search",
    });
    await createVariantViaHttp(seller.ownerToken, draft.id, {
      sku: `M19-DRAFT-${randomUUID()}`,
      title: "Draft Variant",
      price: "80.00",
      currency: "PKR",
    });

    const repository = new SearchDiscoveryRepository();
    await repository.upsertProductSearchDocument({
      productId: published.product.id,
      searchableText: "wireless headphones",
      categoryId: String(category.id),
      categoryPath: "Audio",
      brandId: null,
      brand: null,
      minPrice: "100.00",
      maxPrice: "100.00",
      ratingAvg: "0.00",
      ratingCount: 0,
      inStock: true,
      filterableAttributes: {},
    });
    await repository.upsertProductSearchDocument({
      productId: draft.id,
      searchableText: "private headphones",
      categoryId: String(category.id),
      categoryPath: "Audio",
      brandId: null,
      brand: null,
      minPrice: "80.00",
      maxPrice: "80.00",
      ratingAvg: "0.00",
      ratingCount: 0,
      inStock: true,
      filterableAttributes: {},
    });

    const exact = await repository.searchProducts(
      searchProductsQuerySchema.parse({ q: "headphones", page: "1", pageSize: "20" }),
    );
    expect(exact.items.map((item) => item.productId)).toEqual([published.product.id]);
    expect(exact.items[0]).toMatchObject({
      minCompareAtPrice: "125.00",
      maxCompareAtPrice: "125.00",
    });

    const fuzzy = await repository.searchProducts(
      searchProductsQuerySchema.parse({ q: "wireless headphons", page: "1", pageSize: "20" }),
    );
    expect(fuzzy.items.map((item) => item.productId)).toContain(published.product.id);

    await request(createApp())
      .post(`/api/v1/seller/products/${published.product.id}/unpublish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(200);
    const staleDocumentResult = await repository.searchProducts(
      searchProductsQuerySchema.parse({ q: "wireless headphones" }),
    );
    expect(staleDocumentResult.items).toHaveLength(0);
  });

  it("applies bounded price/brand/attribute/availability filters and returns matching facets", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SearchRepoFacets");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module19-shoes-${randomUUID()}`,
      name: "Shoes",
    });
    const brand = await createBrandViaHttp(adminToken, {
      slug: `module19-brand-${randomUUID()}`,
      name: "Atlas",
    });
    const color = await createAttributeViaHttp(adminToken, {
      code: `module19-color-${randomUUID()}`,
      name: "Color",
      dataType: "option",
      values: [{ value: "Black" }, { value: "White" }],
    });
    const black = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      brandId: String(brand.id),
      label: "BlackRunner",
      price: "50.00",
    });
    const white = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      brandId: String(brand.id),
      label: "WhiteRunner",
      price: "150.00",
    });
    const repository = new SearchDiscoveryRepository();

    await repository.upsertProductSearchDocument({
      productId: black.product.id,
      searchableText: "atlas black running shoe",
      categoryId: String(category.id),
      categoryPath: "Shoes",
      brandId: String(brand.id),
      brand: "Atlas",
      minPrice: "50.00",
      maxPrice: "50.00",
      ratingAvg: "4.50",
      ratingCount: 10,
      inStock: true,
      filterableAttributes: { [String(color.id)]: ["Black"] },
    });
    await repository.upsertProductSearchDocument({
      productId: white.product.id,
      searchableText: "atlas white running shoe",
      categoryId: String(category.id),
      categoryPath: "Shoes",
      brandId: String(brand.id),
      brand: "Atlas",
      minPrice: "150.00",
      maxPrice: "150.00",
      ratingAvg: "3.00",
      ratingCount: 2,
      inStock: false,
      filterableAttributes: { [String(color.id)]: ["White"] },
    });

    const query = searchProductsQuerySchema.parse({
      brandId: brand.id,
      categoryId: category.id,
      attribute: `${color.id}=Black`,
      minPrice: "40.00",
      maxPrice: "100.00",
      minRating: "4",
      inStock: "true",
      sort: "price_asc",
      page: "1",
      pageSize: "5",
    });
    const result = await repository.searchProducts(query);
    const facets = await repository.getProductFacets(query);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ productId: black.product.id, inStock: true });
    expect(facets.categories).toEqual([
      expect.objectContaining({ categoryId: category.id, count: 1 }),
    ]);
    expect(facets.brands).toEqual([
      expect.objectContaining({ brandId: brand.id, label: "Atlas", count: 1 }),
    ]);
    expect(facets.attributes).toEqual([
      expect.objectContaining({ attributeId: color.id, value: "Black", count: 1 }),
    ]);
    expect(facets.summary).toMatchObject({
      minPrice: "50.00",
      maxPrice: "50.00",
      inStockCount: 1,
      outOfStockCount: 0,
    });
  });

  it("enforces one active full-catalog reindex at the database boundary", async () => {
    const repository = new SearchDiscoveryRepository();
    const first = await repository.createReindexRun();

    await expect(repository.createReindexRun()).rejects.toMatchObject({ code: "23505" });
    await expect(repository.markReindexRunRunning(first.id)).resolves.toMatchObject({
      status: "running",
    });
    await expect(repository.markReindexRunCompleted(first.id)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(repository.createReindexRun()).resolves.toMatchObject({ status: "queued" });
  });
});
