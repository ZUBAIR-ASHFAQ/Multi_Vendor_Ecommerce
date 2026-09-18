import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type {
  AttributeResponse,
  BrandResponse,
  CategoryResponse,
} from "../../src/modules/catalog-taxonomy/catalog-taxonomy.schema.js";
import {
  bearer,
  createApprovedSeller,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
  resetModule4Tables,
  type ApprovedSellerFixture,
  type Module4TestUser,
} from "../module4/module4.test-helpers.js";

export {
  bearer,
  createApprovedSeller,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
};
export type { ApprovedSellerFixture, Module4TestUser };

/** Clears Module 5 taxonomy state and then restores deterministic prerequisite Module 2-4 state. */
export async function resetModule5Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      category_attributes,
      attribute_values,
      attributes,
      brands,
      categories
    RESTART IDENTITY CASCADE
  `);
  await resetModule4Tables();
}

/** Creates one category through the exact privileged Module 5 HTTP contract. */
export async function createCategoryViaHttp(
  adminToken: string,
  input: Record<string, unknown>,
): Promise<CategoryResponse> {
  const response = await request(createApp())
    .post("/api/v1/admin/catalog/categories")
    .set(bearer(adminToken))
    .send(input)
    .expect(201);
  return response.body.data as CategoryResponse;
}

/** Creates one brand through the exact privileged Module 5 HTTP contract. */
export async function createBrandViaHttp(
  adminToken: string,
  input: Record<string, unknown>,
): Promise<BrandResponse> {
  const response = await request(createApp())
    .post("/api/v1/admin/catalog/brands")
    .set(bearer(adminToken))
    .send(input)
    .expect(201);
  return response.body.data as BrandResponse;
}

/** Creates one attribute and optional values through the exact privileged Module 5 HTTP contract. */
export async function createAttributeViaHttp(
  adminToken: string,
  input: Record<string, unknown>,
): Promise<AttributeResponse> {
  const response = await request(createApp())
    .post("/api/v1/admin/catalog/attributes")
    .set(bearer(adminToken))
    .send(input)
    .expect(201);
  return response.body.data as AttributeResponse;
}

/** Counts durable Module 5 outbox events by stable event type. */
export async function countCatalogOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Module 5 audit rows by stable action name. */
export async function countCatalogAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
