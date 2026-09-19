import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import {
  PRODUCT_AUDIT_ACTION,
  PRODUCT_ERROR_CODE,
  PRODUCT_OUTBOX_EVENT,
  PRODUCT_PUBLICATION_STATUS,
} from "../../src/modules/products/products.constants.js";
import {
  bearer,
  countProductAuditActions,
  countProductOutboxEvents,
  createAttributeViaHttp,
  createCategoryViaHttp,
  createConfirmedProductMediaFile,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  registerCustomer,
  resetModule6Tables,
} from "./module6.test-helpers.js";

/** Returns documented HTTP methods for one OpenAPI path in stable order. */
function openApiMethods(pathItem: Record<string, unknown> | undefined): string[] {
  const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  return Object.keys(pathItem ?? {}).filter((key) => methods.has(key)).sort();
}

beforeEach(async () => {
  await resetModule6Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 6 repository/service/API integration", () => {
  it("enforces authentication, Product permissions, and seller-to-seller isolation", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "IsolationA");
    const sellerB = await createProductSellerFixture(adminToken, "IsolationB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-isolation",
      name: "Module 6 Isolation",
    });
    const product = await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "seller-a-private-product",
      name: "Seller A Product",
      description: "Private draft",
    });
    const app = createApp();

    await request(app).get("/api/v1/seller/products").expect(401);

    const customer = await registerCustomer(`module6-reader-${randomUUID()}@example.com`, "Reader");
    const customerToken = await loginUser(customer);
    const forbidden = await request(app)
      .get("/api/v1/seller/products")
      .set(bearer(customerToken))
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const sellerAList = await request(app)
      .get("/api/v1/seller/products")
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(sellerAList.body.data.map((item: { id: string }) => item.id)).toEqual([product.id]);

    const sellerBList = await request(app)
      .get("/api/v1/seller/products")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBList.body.data).toEqual([]);

    const hiddenRead = await request(app)
      .get(`/api/v1/seller/products/${product.id}`)
      .set(bearer(sellerB.ownerToken))
      .expect(404);
    expect(hiddenRead.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_NOT_FOUND);

    const hiddenWrite = await request(app)
      .patch(`/api/v1/seller/products/${product.id}`)
      .set(bearer(sellerB.ownerToken))
      .send({ name: "Cross seller overwrite" })
      .expect(404);
    expect(hiddenWrite.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_NOT_FOUND);

    const persisted = await databasePool.query<{ name: string }>(
      "select name from products where id = $1",
      [product.id],
    );
    expect(persisted.rows[0]?.name).toBe("Seller A Product");
  });

  it("enforces globally unique Product slugs across independent sellers", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "SlugA");
    const sellerB = await createProductSellerFixture(adminToken, "SlugB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-slug-category",
      name: "Slug Category",
    });

    await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "globally-unique-product",
      name: "Original Product",
      description: "First owner",
    });

    const duplicate = await request(createApp())
      .post("/api/v1/seller/products")
      .set(bearer(sellerB.ownerToken))
      .send({
        storeId: sellerB.storeId,
        categoryId: category.id,
        slug: "globally-unique-product",
        name: "Duplicate Product",
        description: "Second owner",
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_SLUG_TAKEN);

    const rows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from products where slug = $1",
      ["globally-unique-product"],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("enforces seller/store SKU uniqueness under concurrent requests while allowing another seller to reuse the SKU", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "ConcurrentSkuA");
    const sellerB = await createProductSellerFixture(adminToken, "ConcurrentSkuB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-sku-category",
      name: "SKU Category",
    });
    const productA1 = await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "sku-product-a1",
      name: "SKU Product A1",
      description: "Concurrent SKU A1",
    });
    const productA2 = await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "sku-product-a2",
      name: "SKU Product A2",
      description: "Concurrent SKU A2",
    });
    const app = createApp();
    const payload = {
      sku: "CONCURRENT-SKU",
      title: "Concurrent Variant",
      price: "100.00",
      currency: "PKR",
    };

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/v1/seller/products/${productA1.id}/variants`)
        .set(bearer(sellerA.ownerToken))
        .send(payload),
      request(app)
        .post(`/api/v1/seller/products/${productA2.id}/variants`)
        .set(bearer(sellerA.ownerToken))
        .send(payload),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error.code).toBe(PRODUCT_ERROR_CODE.DUPLICATE_SKU);

    const sellerAOccurrences = await databasePool.query<{ count: number }>(
      `select count(*)::int as count
         from product_variants v
         join products p on p.id = v.product_id
        where p.seller_id = $1 and p.store_id = $2 and v.sku = $3`,
      [sellerA.sellerId, sellerA.storeId, "CONCURRENT-SKU"],
    );
    expect(sellerAOccurrences.rows[0]?.count).toBe(1);

    const productB = await createProductViaHttp(sellerB.ownerToken, {
      storeId: sellerB.storeId,
      categoryId: category.id,
      slug: "sku-product-b",
      name: "SKU Product B",
      description: "Independent seller scope",
    });
    await request(app)
      .post(`/api/v1/seller/products/${productB.id}/variants`)
      .set(bearer(sellerB.ownerToken))
      .send(payload)
      .expect(201);
  });

  it("returns stable taxonomy errors and rolls the Product transaction back when a referenced value does not belong to its attribute", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "TaxonomyRollback");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-taxonomy-rollback",
      name: "Taxonomy Rollback",
    });
    const color = await createAttributeViaHttp(adminToken, {
      code: "module6-color",
      name: "Color",
      dataType: "option",
      values: [{ value: "Red" }],
    });
    const material = await createAttributeViaHttp(adminToken, {
      code: "module6-material",
      name: "Material",
      dataType: "option",
      values: [{ value: "Cotton" }],
    });
    await request(createApp())
      .put(`/api/v1/admin/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .send({
        attributes: [
          { attributeId: color.id, isRequired: true, isFilterable: true, sortOrder: 1 },
          { attributeId: material.id, isRequired: false, isFilterable: true, sortOrder: 2 },
        ],
      })
      .expect(200);

    const wrongValueId = material.values[0]?.id;
    if (!wrongValueId) throw new Error("Material test value is missing.");
    const beforeAudit = await countProductAuditActions(PRODUCT_AUDIT_ACTION.CREATED);
    const beforeOutbox = await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.CREATED);

    const invalid = await request(createApp())
      .post("/api/v1/seller/products")
      .set(bearer(seller.ownerToken))
      .send({
        storeId: seller.storeId,
        categoryId: category.id,
        slug: "invalid-taxonomy-product",
        name: "Invalid Taxonomy Product",
        description: "Must rollback",
        attributes: [{ attributeId: color.id, valueId: wrongValueId }],
      })
      .expect(409);
    expect(invalid.body.error.code).toBe(PRODUCT_ERROR_CODE.INVALID_PRODUCT_ATTRIBUTE);

    const persisted = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from products where slug = $1",
      ["invalid-taxonomy-product"],
    );
    expect(persisted.rows[0]?.count).toBe(0);
    expect(await countProductAuditActions(PRODUCT_AUDIT_ACTION.CREATED)).toBe(beforeAudit);
    expect(await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.CREATED)).toBe(beforeOutbox);
  });

  it("rejects unsupported currency, appends price history only for a real price change, and keeps history immutable", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "PriceHistory");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-price-history",
      name: "Price History",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "price-history-product",
      name: "Price History Product",
      description: "Price audit",
    });
    const app = createApp();

    const unsupported = await request(app)
      .post(`/api/v1/seller/products/${product.id}/variants`)
      .set(bearer(seller.ownerToken))
      .send({ sku: "EUR-SKU", title: "Euro", price: "10.00", currency: "EUR" })
      .expect(409);
    expect(unsupported.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_CURRENCY_UNSUPPORTED);

    const variant = await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "PRICE-SKU",
      title: "Initial title",
      price: "100.00",
      currency: "PKR",
    });

    await request(app)
      .patch(`/api/v1/seller/products/${product.id}/variants/${variant.id}`)
      .set(bearer(seller.ownerToken))
      .send({ title: "Renamed only" })
      .expect(200);
    await request(app)
      .patch(`/api/v1/seller/products/${product.id}/variants/${variant.id}`)
      .set(bearer(seller.ownerToken))
      .send({ price: "100.0" })
      .expect(200);

    let history = await databasePool.query<{ id: string }>(
      "select id from product_price_history where variant_id = $1",
      [variant.id],
    );
    expect(history.rows).toHaveLength(0);

    await request(app)
      .patch(`/api/v1/seller/products/${product.id}/variants/${variant.id}`)
      .set(bearer(seller.ownerToken))
      .send({ price: "125.50" })
      .expect(200);

    history = await databasePool.query<{ id: string; old_price: string; new_price: string }>(
      `select id, old_price::text, new_price::text
         from product_price_history
        where variant_id = $1`,
      [variant.id],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({ old_price: "100.00", new_price: "125.50" });
    expect(await countProductAuditActions(PRODUCT_AUDIT_ACTION.PRICE_CHANGED)).toBe(1);
    expect(await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.PRICE_CHANGED)).toBe(1);

    await expect(
      databasePool.query("delete from product_price_history where id = $1", [history.rows[0]?.id]),
    ).rejects.toThrow();
  });

  it("requires a valid active variant before publication and keeps public visibility tied to lifecycle and seller eligibility", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "Publication");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-publication",
      name: "Publication",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "publication-product",
      name: "Publication Product",
      description: "Lifecycle test",
    });
    const app = createApp();

    await request(app).get(`/api/v1/products/${product.slug}`).expect(404);
    const missingVariant = await request(app)
      .post(`/api/v1/seller/products/${product.id}/publish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(409);
    expect(missingVariant.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_NOT_PUBLISHABLE);

    await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "PUBLISH-SKU",
      title: "Published Variant",
      price: "200.00",
      currency: "PKR",
    });
    const published = await request(app)
      .post(`/api/v1/seller/products/${product.id}/publish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(200);
    expect(published.body.data.publicationStatus).toBe(PRODUCT_PUBLICATION_STATUS.PUBLISHED);

    const publicDetail = await request(app).get(`/api/v1/products/${product.slug}`).expect(200);
    expect(publicDetail.body.data).not.toHaveProperty("sellerId");
    expect(publicDetail.body.data).not.toHaveProperty("publicationStatus");
    expect(publicDetail.body.data.variants).toHaveLength(1);

    await request(app)
      .post(`/api/v1/seller/products/${product.id}/unpublish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(200);
    await request(app).get(`/api/v1/products/${product.slug}`).expect(404);

    await request(app)
      .post(`/api/v1/seller/products/${product.id}/publish`)
      .set(bearer(seller.ownerToken))
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/sellers/${seller.sellerId}/suspend`)
      .set(bearer(adminToken))
      .send({ reason: "Module 6 public filter test" })
      .expect(200);
    await request(app).get(`/api/v1/products/${product.slug}`).expect(404);
  });

  it("derives media type from confirmed Module 21 metadata and rejects unsupported MIME types", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "Media");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-media",
      name: "Media",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "media-product",
      name: "Media Product",
      description: "Media validation",
    });
    const imageFileId = await createConfirmedProductMediaFile(seller.owner.id, "image/png");
    const pdfFileId = await createConfirmedProductMediaFile(seller.owner.id, "application/pdf");
    const app = createApp();

    const linked = await request(app)
      .post(`/api/v1/seller/products/${product.id}/media`)
      .set(bearer(seller.ownerToken))
      .send({ fileId: imageFileId, altText: "Front" })
      .expect(201);
    expect(linked.body.data.media).toHaveLength(1);
    expect(linked.body.data.media[0]).toMatchObject({ fileId: imageFileId, mediaType: "image" });

    const invalid = await request(app)
      .post(`/api/v1/seller/products/${product.id}/media`)
      .set(bearer(seller.ownerToken))
      .send({ fileId: pdfFileId })
      .expect(422);
    expect(invalid.body.error.code).toBe(ERROR_CODE.INVALID_REQUEST);

    const rows = await databasePool.query<{ media_type: string }>(
      "select media_type from product_media where product_id = $1 order by created_at",
      [product.id],
    );
    expect(rows.rows).toEqual([{ media_type: "image" }]);
    expect(await countProductAuditActions(PRODUCT_AUDIT_ACTION.MEDIA_LINKED)).toBe(1);
    expect(await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.MEDIA_CHANGED)).toBe(1);
  });

  it("allows the explicit admin approval command only for pending Products and revalidates before publishing", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "Approval");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-approval",
      name: "Approval",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "approval-product",
      name: "Approval Product",
      description: "Moderation command",
    });
    await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "APPROVAL-SKU",
      title: "Approval Variant",
      price: "50.00",
      currency: "PKR",
    });
    const app = createApp();

    const invalidState = await request(app)
      .post(`/api/v1/admin/products/${product.id}/approve`)
      .set(bearer(adminToken))
      .send({})
      .expect(409);
    expect(invalidState.body.error.code).toBe(PRODUCT_ERROR_CODE.PRODUCT_NOT_PUBLISHABLE);

    await databasePool.query(
      "update products set publication_status = $1, published_at = null where id = $2",
      [PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL, product.id],
    );
    const approved = await request(app)
      .post(`/api/v1/admin/products/${product.id}/approve`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(approved.body.data.publicationStatus).toBe(PRODUCT_PUBLICATION_STATUS.PUBLISHED);
    await request(app).get(`/api/v1/products/${product.slug}`).expect(200);
    expect(await countProductAuditActions(PRODUCT_AUDIT_ACTION.APPROVED)).toBe(1);
    expect(await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.PUBLISHED)).toBe(1);
  });

  it("lets an admin list, inspect, and reject a pending Product with a seller-visible reason", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "Rejection");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "module6-rejection",
      name: "Rejection",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "rejection-product",
      name: "Rejection Product",
      description: "Moderation rejection command",
    });
    await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "REJECTION-SKU",
      title: "Rejection Variant",
      price: "75.00",
      currency: "PKR",
    });
    await databasePool.query(
      "update products set publication_status = $1, published_at = null where id = $2",
      [PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL, product.id],
    );
    const app = createApp();

    const queue = await request(app)
      .get("/api/v1/admin/products")
      .set(bearer(adminToken))
      .expect(200);
    expect(queue.body.data.map((entry: { id: string }) => entry.id)).toContain(product.id);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(detail.body.data.variants).toHaveLength(1);

    await request(app)
      .post(`/api/v1/admin/products/${product.id}/reject`)
      .set(bearer(adminToken))
      .send({ reason: "   " })
      .expect(422);

    const rejected = await request(app)
      .post(`/api/v1/admin/products/${product.id}/reject`)
      .set(bearer(adminToken))
      .send({ reason: "Add a clear front image." })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      publicationStatus: PRODUCT_PUBLICATION_STATUS.REJECTED,
      moderationReason: "Add a clear front image.",
    });
    expect(rejected.body.data.reviewedBy).toBe(admin.id);
    expect(rejected.body.data.reviewedAt).toBeTruthy();

    const sellerDetail = await request(app)
      .get(`/api/v1/seller/products/${product.id}`)
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(sellerDetail.body.data.moderationReason).toBe("Add a clear front image.");
    expect(await countProductAuditActions(PRODUCT_AUDIT_ACTION.REJECTED)).toBe(1);
    expect(await countProductOutboxEvents(PRODUCT_OUTBOX_EVENT.REJECTED)).toBe(1);
  });

  it("publishes exactly the approved Module 6 operations plus the seller-detail remediation and no generic delete routes", async () => {
    const response = await request(createApp()).get("/openapi.json").expect(200);
    const paths = response.body.paths as Record<string, Record<string, unknown>>;
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
      expect(openApiMethods(paths[path])).toEqual(methods.sort());
    }

    const productOperations = Object.entries(paths)
      .flatMap(([path, pathItem]) =>
        openApiMethods(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .filter((operation) => operation.includes("/api/v1/products") || operation.includes("/api/v1/seller/products") || operation.includes("/api/v1/admin/products"))
      .sort();
    const expectedOperations = Object.entries(expected)
      .flatMap(([path, methods]) => methods.map((method) => `${method.toUpperCase()} ${path}`))
      .sort();
    expect(productOperations).toEqual(expectedOperations);

    await request(createApp())
      .delete(`/api/v1/seller/products/${randomUUID()}`)
      .expect(404);
    await request(createApp())
      .delete(`/api/v1/admin/products/${randomUUID()}`)
      .expect(404);
  });
});
