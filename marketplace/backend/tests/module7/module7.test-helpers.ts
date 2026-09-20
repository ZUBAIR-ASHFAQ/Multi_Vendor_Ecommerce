import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type { ProductVariantResponse } from "../../src/modules/products/products.schema.js";
import {
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
  resetModule6Tables,
  type ApprovedSellerFixture,
  type Module4TestUser,
} from "../module6/module6.test-helpers.js";

export {
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

export const MODULE7_TEST_INTERNAL_API_KEY =
  "module7-test-internal-api-key-that-is-at-least-32-characters";

/** Clears Module 7 persistence first, then restores deterministic Module 2-6 prerequisite state. */
export async function resetModule7Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      stock_movements,
      stock_reservations,
      inventory_items
    RESTART IDENTITY CASCADE
  `);
  await resetModule6Tables();
}

/** Returns the trusted internal API-key header used by Module 7 commerce-command tests. */
export function internalApiKey(): { "x-internal-api-key": string } {
  return {
    "x-internal-api-key": process.env.INTERNAL_API_KEY ?? MODULE7_TEST_INTERNAL_API_KEY,
  };
}

/** Creates one Product and variant under an already approved seller/store for Inventory tests. */
export async function createInventoryVariantFixture(
  ownerToken: string,
  storeId: string,
  categoryId: string,
  label: string,
): Promise<{ productId: string; variant: ProductVariantResponse }> {
  const suffix = randomUUID();
  const product = await createProductViaHttp(ownerToken, {
    storeId,
    categoryId,
    slug: `module7-${label.toLowerCase()}-${suffix}`,
    name: `${label} Inventory Product`,
    description: "Module 7 Inventory test Product",
  });
  const variant = await createVariantViaHttp(ownerToken, product.id, {
    sku: `M7-${label.toUpperCase()}-${suffix}`,
    title: `${label} Variant`,
    price: "100.00",
    currency: "PKR",
  });
  return { productId: product.id, variant };
}

/** Applies a seller stock adjustment through the exact Module 7 HTTP contract. */
export async function adjustInventoryViaHttp(
  ownerToken: string,
  variantId: string,
  quantityDelta: number,
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post(`/api/v1/seller/inventory/${variantId}/adjust`)
    .set(bearer(ownerToken))
    .send({ quantityDelta })
    .expect(200);
  return response.body.data as Record<string, unknown>;
}

/** Creates one stock reservation through the trusted internal Module 7 HTTP contract. */
export async function reserveInventoryViaHttp(input: {
  variantId: string;
  customerUserId: string;
  quantity: number;
  sourceKey: string;
  expiresAt?: string;
  orderAttemptId?: string | null;
}): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post("/api/v1/internal/inventory/reserve")
    .set(internalApiKey())
    .send({
      ...input,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .expect(200);
  return response.body.data as Record<string, unknown>;
}

/** Counts durable Module 7 outbox events by stable event type. */
export async function countInventoryOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 7 audit rows by stable action name. */
export async function countInventoryAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
