import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type {
  ProductDetailResponse,
  ProductVariantResponse,
} from "../../src/modules/products/products.schema.js";
import {
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
  type ApprovedSellerFixture,
  type Module4TestUser,
} from "../module6/module6.test-helpers.js";
import {
  adjustInventoryViaHttp,
  resetModule7Tables,
} from "../module7/module7.test-helpers.js";

export {
  adjustInventoryViaHttp,
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
};
export type { ApprovedSellerFixture, Module4TestUser };

/** Public Product fixture used by Module 8 API tests after publication and optional stock setup. */
export interface PublishedCartWishlistFixture {
  seller: ApprovedSellerFixture & { storeId: string };
  product: ProductDetailResponse;
  variant: ProductVariantResponse;
}

/** Inventory quantities used to prove Cart/Wishlist reads never reserve or mutate stock. */
export interface InventoryQuantitySnapshot {
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

/** Clears Module 8 persistence first, then restores deterministic Module 2-7 prerequisite state. */
export async function resetModule8Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      wishlist_items,
      wishlists,
      cart_items,
      carts
    RESTART IDENTITY CASCADE
  `);
  await resetModule7Tables();
}

/** Creates one Product and variant under an approved seller/store for Module 8 repository tests. */
export async function createCartWishlistVariantFixture(
  adminToken: string,
  label: string,
  currency = "PKR",
): Promise<{ productId: string; variant: ProductVariantResponse }> {
  const seller = await createProductSellerFixture(adminToken, `CartWishlist${label}`);
  const category = await createCategoryViaHttp(adminToken, {
    slug: `module8-repo-${label.toLowerCase()}-${randomUUID()}`,
    name: `Module 8 ${label} Category`,
  });
  const product = await createProductViaHttp(seller.ownerToken, {
    storeId: seller.storeId,
    categoryId: String(category.id),
    slug: `module8-repo-product-${label.toLowerCase()}-${randomUUID()}`,
    name: `Module 8 ${label} Product`,
    description: "Module 8 repository fixture Product",
  });
  const variant = await createVariantViaHttp(seller.ownerToken, product.id, {
    sku: `M8-${label.toUpperCase()}-${randomUUID()}`,
    title: `${label} Variant`,
    price: "100.00",
    currency,
  });

  return { productId: product.id, variant };
}

/** Publishes one seller-owned Product through the released Module 6 command endpoint. */
export async function publishProductViaHttp(
  ownerToken: string,
  productId: string,
): Promise<ProductDetailResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/products/${productId}/publish`)
    .set(bearer(ownerToken))
    .send({})
    .expect(200);
  return response.body.data as ProductDetailResponse;
}

/** Creates one published Product/variant and optional on-hand stock for end-to-end Module 8 backend tests. */
export async function createPublishedCartWishlistFixture(
  adminToken: string,
  label: string,
  options: { currency?: string; price?: string; onHandQty?: number } = {},
): Promise<PublishedCartWishlistFixture> {
  const suffix = randomUUID();
  const seller = await createProductSellerFixture(adminToken, `Module8${label}`);
  const category = await createCategoryViaHttp(adminToken, {
    slug: `module8-${label.toLowerCase()}-${suffix}`,
    name: `Module 8 ${label}`,
  });
  const product = await createProductViaHttp(seller.ownerToken, {
    storeId: seller.storeId,
    categoryId: String(category.id),
    slug: `module8-${label.toLowerCase()}-product-${suffix}`,
    name: `Module 8 ${label} Product`,
    description: "Module 8 integration Product",
  });
  const variant = await createVariantViaHttp(seller.ownerToken, product.id, {
    sku: `M8-${label.toUpperCase()}-${suffix}`,
    title: `${label} Variant`,
    price: options.price ?? "100.00",
    currency: options.currency ?? "PKR",
  });
  await publishProductViaHttp(seller.ownerToken, product.id);

  const onHandQty = options.onHandQty ?? 0;
  if (onHandQty > 0) {
    await adjustInventoryViaHttp(seller.ownerToken, variant.id, onHandQty);
  }

  return { seller, product, variant };
}

/** Updates one seller-owned variant through the released Product HTTP contract. */
export async function updateVariantViaHttp(
  ownerToken: string,
  productId: string,
  variantId: string,
  input: Record<string, unknown>,
): Promise<ProductDetailResponse> {
  const response = await request(createApp())
    .patch(`/api/v1/seller/products/${productId}/variants/${variantId}`)
    .set(bearer(ownerToken))
    .send(input)
    .expect(200);
  return response.body.data as ProductDetailResponse;
}

/** Unpublishes one seller-owned Product through the released explicit lifecycle command. */
export async function unpublishProductViaHttp(
  ownerToken: string,
  productId: string,
): Promise<ProductDetailResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/products/${productId}/unpublish`)
    .set(bearer(ownerToken))
    .send({})
    .expect(200);
  return response.body.data as ProductDetailResponse;
}

/** Reads authoritative Inventory quantities directly for a test-only before/after invariant comparison. */
export async function readInventoryQuantities(
  variantId: string,
): Promise<InventoryQuantitySnapshot> {
  const result = await databasePool.query<{
    on_hand_qty: number;
    reserved_qty: number;
    available_qty: number;
  }>(
    `select
       on_hand_qty,
       reserved_qty,
       (on_hand_qty - reserved_qty)::int as available_qty
     from inventory_items
     where variant_id = $1`,
    [variantId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Module 8 Inventory fixture was not found.");

  return {
    onHandQty: row.on_hand_qty,
    reservedQty: row.reserved_qty,
    availableQty: row.available_qty,
  };
}

/** Counts durable Module 8 outbox events by the stable event type from the requirements contract. */
export async function countCartWishlistOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}
