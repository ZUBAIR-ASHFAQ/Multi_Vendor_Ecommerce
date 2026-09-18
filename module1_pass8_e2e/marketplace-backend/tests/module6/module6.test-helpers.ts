import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import { DOCUMENT_FILE_STATUS, DOCUMENT_PURPOSE } from "../../src/modules/documents-audit/documents-audit.constants.js";
import type {
  ProductDetailResponse,
  ProductVariantResponse,
} from "../../src/modules/products/products.schema.js";
import {
  bearer,
  createApprovedSeller,
  createPlatformAdmin,
  createStoreViaHttp,
  loginUser,
  registerCustomer,
  type ApprovedSellerFixture,
  type Module4TestUser,
} from "../module4/module4.test-helpers.js";
import {
  createAttributeViaHttp,
  createBrandViaHttp,
  createCategoryViaHttp,
  resetModule5Tables,
} from "../module5/module5.test-helpers.js";

export {
  bearer,
  createApprovedSeller,
  createAttributeViaHttp,
  createBrandViaHttp,
  createCategoryViaHttp,
  createPlatformAdmin,
  createStoreViaHttp,
  loginUser,
  registerCustomer,
};
export type { ApprovedSellerFixture, Module4TestUser };

/** Clears Module 6 persistence first, then restores deterministic Module 2-5 prerequisite state. */
export async function resetModule6Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      product_price_history,
      product_media,
      product_attribute_values,
      product_variants,
      products
    RESTART IDENTITY CASCADE
  `);
  await resetModule5Tables();
}

/** Creates one approved seller plus one active seller-owned store for Product tests. */
export async function createProductSellerFixture(
  adminToken: string,
  label: string,
): Promise<ApprovedSellerFixture & { storeId: string }> {
  const seller = await createApprovedSeller(adminToken, label);
  const store = await createStoreViaHttp(
    seller.ownerToken,
    `module6-${label.toLowerCase()}-${randomUUID()}`,
  );

  return { ...seller, storeId: String(store.id) };
}

/** Creates one Product draft through the real seller HTTP contract. */
export async function createProductViaHttp(
  ownerToken: string,
  input: Record<string, unknown>,
): Promise<ProductDetailResponse> {
  const response = await request(createApp())
    .post("/api/v1/seller/products")
    .set(bearer(ownerToken))
    .send(input)
    .expect(201);
  return response.body.data as ProductDetailResponse;
}

/** Adds one Product variant through the exact seller HTTP contract and returns the newly added variant. */
export async function createVariantViaHttp(
  ownerToken: string,
  productId: string,
  input: Record<string, unknown>,
): Promise<ProductVariantResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/products/${productId}/variants`)
    .set(bearer(ownerToken))
    .send(input)
    .expect(201);
  const detail = response.body.data as ProductDetailResponse;
  const variant = detail.variants.at(-1);
  if (!variant) throw new Error("Module 6 variant create response did not contain a variant.");
  return variant;
}

/** Inserts a confirmed Product-media file without contacting object storage. */
export async function createConfirmedProductMediaFile(
  ownerUserId: string,
  mimeType = "image/png",
): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into files
      (object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      `module6-tests/${randomUUID()}`,
      DOCUMENT_PURPOSE.PRODUCT_MEDIA,
      mimeType.startsWith("video/") ? "demo.mp4" : "demo.png",
      mimeType,
      1024,
      ownerUserId,
      DOCUMENT_FILE_STATUS.CONFIRMED,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 6 media test file insert did not return an id.");
  return id;
}

/** Counts durable Module 6 outbox events by stable event type. */
export async function countProductOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 6 audit rows by stable action name. */
export async function countProductAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
