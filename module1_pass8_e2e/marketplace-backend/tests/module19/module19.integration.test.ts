import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  SEARCH_ERROR_CODE,
  SEARCH_OUTBOX_EVENT,
  SEARCH_PERMISSION,
  SEARCH_REINDEX_FAILURE_CODE,
} from "../../src/modules/search-discovery/search-discovery.constants.js";
import { SearchDiscoveryService } from "../../src/modules/search-discovery/search-discovery.service.js";
import {
  adjustInventoryViaHttp,
  bearer,
  countSearchOutboxEvents,
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedSearchProduct,
  loginUser,
  registerCustomer,
  resetModule19Tables,
  searchRepository,
  synchronizeSearchProduct,
} from "./module19.test-helpers.js";

beforeEach(async () => {
  await resetModule19Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Builds the server-derived admin context used by direct service concurrency tests. */
function adminContext(actorId: string): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set([SEARCH_PERMISSION.ADMIN_MANAGE]),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

describe("Module 19 API, privacy, synchronization, and reindex integration", () => {
  it("serves anonymous public Search from synchronized source data without seller-private fields", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SearchApiPublic");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module19-public-${randomUUID()}`,
      name: "Public Search",
    });
    const fixture = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      label: "Discoverable",
      price: "75.00",
    });
    await synchronizeSearchProduct(fixture.product.id);

    const response = await request(createApp())
      .get("/api/v1/search/products")
      .query({ q: "Discoverable", page: 1, pageSize: 20 })
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      productId: fixture.product.id,
      inStock: false,
      minPrice: "75.00",
    });
    expect(response.body.data.items[0]).not.toHaveProperty("sellerId");
    expect(response.body.data.items[0]).not.toHaveProperty("publicationStatus");
    expect(response.body.data.items[0]).not.toHaveProperty("createdBy");
  });

  it("refreshes the cached availability bit from Inventory events and removes stale documents on unpublish", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SearchEventSync");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module19-event-sync-${randomUUID()}`,
      name: "Event Sync",
    });
    const fixture = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      label: "EventDriven",
    });
    const service = new SearchDiscoveryService();
    await service.handleSourceEvent({
      eventType: "product.published",
      aggregateId: fixture.product.id,
      payload: { productId: fixture.product.id },
    });

    let document = await databasePool.query<{ in_stock: boolean }>(
      "select in_stock from product_search_documents where product_id = $1",
      [fixture.product.id],
    );
    expect(document.rows[0]?.in_stock).toBe(false);

    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    await service.handleSourceEvent({
      eventType: "inventory.adjusted",
      aggregateId: randomUUID(),
      payload: { variantId: fixture.variant.id },
    });
    document = await databasePool.query<{ in_stock: boolean }>(
      "select in_stock from product_search_documents where product_id = $1",
      [fixture.product.id],
    );
    expect(document.rows[0]?.in_stock).toBe(true);

    await request(createApp())
      .post(`/api/v1/seller/products/${fixture.product.id}/unpublish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(200);
    await service.handleSourceEvent({
      eventType: "product.unpublished",
      aggregateId: fixture.product.id,
      payload: { productId: fixture.product.id },
    });
    const removed = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from product_search_documents where product_id = $1",
      [fixture.product.id],
    );
    expect(removed.rows[0]?.count).toBe(0);
  });

  it("returns SEARCH_QUERY_INVALID for malformed storefront filters", async () => {
    const response = await request(createApp())
      .get("/api/v1/search/products")
      .query({ sort: "DROP TABLE products", pageSize: 999999 })
      .expect(400);

    expect(response.body.error.code).toBe(SEARCH_ERROR_CODE.SEARCH_QUERY_INVALID);
  });

  it("requires admin Search permission for reindex endpoints and hides unauthorized admin operations", async () => {
    const customer = await registerCustomer(`module19-search-admin-denied-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const app = createApp();

    await request(app).post("/api/v1/admin/search/reindex").send({}).expect(401);
    await request(app)
      .post("/api/v1/admin/search/reindex")
      .set(bearer(customerToken))
      .send({})
      .expect(403);
    await request(app)
      .get(`/api/v1/admin/search/reindex/${randomUUID()}`)
      .set(bearer(customerToken))
      .expect(403);
  });

  it("allows only one concurrent full reindex request and keeps the winning queue operation retry-safe", async () => {
    const admin = await createPlatformAdmin();
    const reindexEnqueuer = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const firstService = new SearchDiscoveryService({ reindexEnqueuer });
    const secondService = new SearchDiscoveryService({ reindexEnqueuer });
    const context = adminContext(admin.id);

    const results = await Promise.allSettled([
      firstService.queueFullReindex(context),
      secondService.queueFullReindex(context),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: SEARCH_ERROR_CODE.SEARCH_REINDEX_RUNNING,
      statusCode: 409,
    });
    expect(reindexEnqueuer.enqueue).toHaveBeenCalledTimes(1);

    const rows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from search_reindex_runs where status in ('queued', 'running')",
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("compensates a BullMQ enqueue failure with stable failed state and durable failure event", async () => {
    const admin = await createPlatformAdmin();
    const service = new SearchDiscoveryService({
      reindexEnqueuer: { enqueue: vi.fn().mockRejectedValue(new Error("redis unavailable")) },
    });

    await expect(service.queueFullReindex(adminContext(admin.id))).rejects.toMatchObject({
      code: SEARCH_ERROR_CODE.SEARCH_INDEX_UNAVAILABLE,
      statusCode: 503,
    });

    const result = await databasePool.query<{
      status: string;
      error_code: string | null;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `select status, error_code, started_at, completed_at
       from search_reindex_runs
       order by requested_at desc
       limit 1`,
    );
    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error_code: SEARCH_REINDEX_FAILURE_CODE.QUEUE_UNAVAILABLE,
    });
    expect(result.rows[0]?.started_at).not.toBeNull();
    expect(result.rows[0]?.completed_at).not.toBeNull();
    expect(await countSearchOutboxEvents(SEARCH_OUTBOX_EVENT.REINDEX_FAILED)).toBe(1);
  });

  it("runs a full reindex to completion and repeating the completed job does not duplicate Search documents", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SearchFullReindex");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module19-reindex-${randomUUID()}`,
      name: "Reindex Category",
    });
    const fixture = await createPublishedSearchProduct({
      ownerToken: seller.ownerToken,
      storeId: seller.storeId,
      categoryId: String(category.id),
      label: "Reindexed",
    });
    const repository = searchRepository();
    const run = await repository.createReindexRun();
    const service = new SearchDiscoveryService({
      reindexEnqueuer: { enqueue: vi.fn().mockResolvedValue(undefined) },
    });

    const first = await service.runFullReindex(run.id);
    const second = await service.runFullReindex(run.id);

    expect(first.status).toBe("completed");
    expect(second).toEqual(first);
    const documentCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from product_search_documents where product_id = $1",
      [fixture.product.id],
    );
    expect(documentCount.rows[0]?.count).toBe(1);
    expect(await countSearchOutboxEvents(SEARCH_OUTBOX_EVENT.REINDEX_STARTED)).toBe(1);
    expect(await countSearchOutboxEvents(SEARCH_OUTBOX_EVENT.REINDEX_COMPLETED)).toBe(1);
  });
});
