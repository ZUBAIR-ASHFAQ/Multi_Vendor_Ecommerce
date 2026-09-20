import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type { PromotionResponse } from "../../src/modules/promotions/promotions.schema.js";
import {
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  loginUser,
  registerCustomer,
  resetModule8Tables,
  type ApprovedSellerFixture,
  type Module4TestUser,
  type PublishedCartWishlistFixture,
} from "../module8/module8.test-helpers.js";

export {
  bearer,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  loginUser,
  registerCustomer,
};
export type {
  ApprovedSellerFixture,
  Module4TestUser,
  PublishedCartWishlistFixture,
};

/** Clears Module 9 persistence before resetting every released prerequisite fixture table. */
export async function resetModule9Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      coupon_redemptions,
      coupons,
      promotion_scopes,
      promotions
    RESTART IDENTITY CASCADE
  `);
  await resetModule8Tables();
}

/** Returns a promotion window that is active around the current test clock. */
export function activePromotionWindow(): { startAt: string; endAt: string } {
  const now = Date.now();
  return {
    startAt: new Date(now - 60_000).toISOString(),
    endAt: new Date(now + 60 * 60_000).toISOString(),
  };
}

/** Returns a future promotion window suitable for scheduled lifecycle tests. */
export function futurePromotionWindow(): { startAt: string; endAt: string } {
  const now = Date.now();
  return {
    startAt: new Date(now + 60 * 60_000).toISOString(),
    endAt: new Date(now + 2 * 60 * 60_000).toISOString(),
  };
}

/** Creates one platform promotion through the exact Module 9 administrator HTTP contract. */
export async function createPlatformPromotionViaHttp(
  adminToken: string,
  input: Record<string, unknown>,
): Promise<PromotionResponse> {
  const response = await request(createApp())
    .post("/api/v1/admin/promotions")
    .set(bearer(adminToken))
    .send(input)
    .expect(201);
  return response.body.data as PromotionResponse;
}

/** Creates one seller-funded promotion through the exact Module 9 seller HTTP contract. */
export async function createSellerPromotionViaHttp(
  sellerToken: string,
  input: Record<string, unknown>,
): Promise<PromotionResponse> {
  const response = await request(createApp())
    .post("/api/v1/seller/promotions")
    .set(bearer(sellerToken))
    .send(input)
    .expect(201);
  return response.body.data as PromotionResponse;
}

/** Activates or schedules one promotion through the explicit administrator command. */
export async function activatePromotionViaHttp(
  adminToken: string,
  promotionId: string,
): Promise<PromotionResponse> {
  const response = await request(createApp())
    .post(`/api/v1/admin/promotions/${promotionId}/activate`)
    .set(bearer(adminToken))
    .send({})
    .expect(200);
  return response.body.data as PromotionResponse;
}

/** Adds one released Product variant to the authenticated customer's Cart. */
export async function addCartItemViaHttp(
  customerToken: string,
  variantId: string,
  quantity: number,
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post("/api/v1/cart/items")
    .set(bearer(customerToken))
    .send({ variantId, quantity })
    .expect(200);
  return response.body.data as Record<string, unknown>;
}

/** Counts durable Module 9 outbox events by the stable event type. */
export async function countPromotionOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 9 audit rows by the stable promotion action name. */
export async function countPromotionAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}

/** Creates a unique test coupon code while keeping the production normalization convention visible. */
export function uniqueCouponCode(prefix = "SAVE"): string {
  return `${prefix}-${randomUUID()}`.toUpperCase();
}
