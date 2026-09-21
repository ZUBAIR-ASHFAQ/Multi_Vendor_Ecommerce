import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import { SearchDiscoveryRepository } from "../../src/modules/search-discovery/search-discovery.repository.js";
import { SearchDiscoveryService } from "../../src/modules/search-discovery/search-discovery.service.js";
import type {
  ProductDetailResponse,
  ProductVariantResponse,
} from "../../src/modules/products/products.schema.js";
import {
  adjustInventoryViaHttp,
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
  resetModule7Tables,
  type ApprovedSellerFixture,
  type Module4TestUser,
} from "../module7/module7.test-helpers.js";
import {
  createAttributeViaHttp,
  createBrandViaHttp,
} from "../module6/module6.test-helpers.js";

export {
  adjustInventoryViaHttp,
  bearer,
  createAttributeViaHttp,
  createBrandViaHttp,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
};
export type { ApprovedSellerFixture, Module4TestUser };

/** Clears Module 19 derived persistence before resetting every prerequisite module table. */
export async function resetModule19Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      product_search_documents,
      search_synonyms,
      search_reindex_runs
    RESTART IDENTITY CASCADE
  `);
  await resetModule7Tables();
}

/** Creates and publishes one Product with one active variant through the real seller HTTP surface. */
export async function createPublishedSearchProduct(input: {
  ownerToken: string;
  storeId: string;
  categoryId: string;
  label: string;
  brandId?: string | null;
  price?: string;
  compareAtPrice?: string;
}): Promise<{ product: ProductDetailResponse; variant: ProductVariantResponse }> {
  const suffix = randomUUID();
  const product = await createProductViaHttp(input.ownerToken, {
    storeId: input.storeId,
    categoryId: input.categoryId,
    brandId: input.brandId ?? null,
    slug: `module19-${input.label.toLowerCase()}-${suffix}`,
    name: `${input.label} Search Product`,
    description: `Module 19 ${input.label} discovery fixture`,
  });
  const variant = await createVariantViaHttp(input.ownerToken, product.id, {
    sku: `M19-${input.label.toUpperCase()}-${suffix}`,
    title: `${input.label} Variant`,
    price: input.price ?? "100.00",
    ...(input.compareAtPrice ? { compareAtPrice: input.compareAtPrice } : {}),
    currency: "PKR",
  });
  const response = await request(createApp())
    .post(`/api/v1/seller/products/${product.id}/publish`)
    .set(bearer(input.ownerToken))
    .send({})
    .expect(200);

  return {
    product: response.body.data as ProductDetailResponse,
    variant,
  };
}

/** Rebuilds one Search document from the real Product/Catalog/Inventory service boundaries. */
export async function synchronizeSearchProduct(productId: string): Promise<boolean> {
  return new SearchDiscoveryService().synchronizeProductDocument(productId);
}

/** Counts durable Module 19 outbox events by stable event type. */
export async function countSearchOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Returns the persistence repository used by focused Search integration tests. */
export function searchRepository(): SearchDiscoveryRepository {
  return new SearchDiscoveryRepository();
}
