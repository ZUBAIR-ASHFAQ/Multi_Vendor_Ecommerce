import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import {
  CATALOG_AUDIT_ACTION,
  CATALOG_ERROR_CODE,
  CATALOG_OUTBOX_EVENT,
  CATALOG_STATUS,
} from "../../src/modules/catalog-taxonomy/catalog-taxonomy.constants.js";
import { CatalogTaxonomyService } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.service.js";
import {
  bearer,
  countCatalogAuditActions,
  countCatalogOutboxEvents,
  createApprovedSeller,
  createAttributeViaHttp,
  createBrandViaHttp,
  createCategoryViaHttp,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
  resetModule5Tables,
} from "./module5.test-helpers.js";

/** Returns the documented HTTP methods for one OpenAPI path in stable order. */
function openApiMethods(pathItem: Record<string, unknown> | undefined): string[] {
  const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  return Object.keys(pathItem ?? {})
    .filter((key) => methods.has(key))
    .sort();
}

beforeEach(async () => {
  await resetModule5Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 5 repository/service/API integration", () => {
  it("enforces admin mutation permissions while keeping active taxonomy publicly readable", async () => {
    const app = createApp();
    const customer = await registerCustomer(
      `module5-customer-${randomUUID()}@example.com`,
      "Catalog Customer",
    );
    const customerToken = await loginUser(customer);

    await request(app).get("/api/v1/catalog/categories").expect(200);
    await request(app)
      .get("/api/v1/catalog/categories")
      .set("Authorization", "Bearer invalid-token")
      .expect(401);

    const forbidden = await request(app)
      .post("/api/v1/admin/catalog/categories")
      .set(bearer(customerToken))
      .send({ slug: "phones", name: "Phones" })
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    await request(app)
      .post("/api/v1/admin/catalog/categories")
      .send({ slug: "phones", name: "Phones" })
      .expect(401);
  });

  it("creates a category hierarchy, rejects duplicate slugs, prevents descendant cycles, and filters inactive branches", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();
    const electronics = await createCategoryViaHttp(adminToken, {
      slug: "  ELECTRONICS  ",
      name: " Electronics ",
      sortOrder: 1,
    });
    const phones = await createCategoryViaHttp(adminToken, {
      parentId: electronics.id,
      slug: "phones",
      name: "Phones",
      sortOrder: 1,
    });
    const smartphones = await createCategoryViaHttp(adminToken, {
      parentId: phones.id,
      slug: "smartphones",
      name: "Smartphones",
      sortOrder: 1,
    });

    expect(electronics).toMatchObject({ slug: "electronics", name: "Electronics" });

    const missingParent = await request(app)
      .post("/api/v1/admin/catalog/categories")
      .set(bearer(adminToken))
      .send({ parentId: randomUUID(), slug: "orphan", name: "Orphan" })
      .expect(404);
    expect(missingParent.body.error.code).toBe(CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND);

    expect(await countCatalogOutboxEvents(CATALOG_OUTBOX_EVENT.CATEGORY_CREATED)).toBe(3);
    expect(await countCatalogAuditActions(CATALOG_AUDIT_ACTION.CATEGORY_CREATED)).toBe(3);

    const duplicate = await request(app)
      .post("/api/v1/admin/catalog/categories")
      .set(bearer(adminToken))
      .send({ slug: "electronics", name: "Duplicate Electronics" })
      .expect(409);
    expect(duplicate.body.error.code).toBe(CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE);

    const cycle = await request(app)
      .patch(`/api/v1/admin/catalog/categories/${electronics.id}`)
      .set(bearer(adminToken))
      .send({ parentId: smartphones.id })
      .expect(409);
    expect(cycle.body.error.code).toBe(CATALOG_ERROR_CODE.CATEGORY_CYCLE);

    await request(app)
      .patch(`/api/v1/admin/catalog/categories/${phones.id}`)
      .set(bearer(adminToken))
      .send({ status: CATALOG_STATUS.INACTIVE })
      .expect(200);

    const publicTree = await request(app).get("/api/v1/catalog/categories").expect(200);
    expect(publicTree.body.data[0].children).toEqual([]);

    const adminTree = await request(app)
      .get("/api/v1/catalog/categories")
      .set(bearer(adminToken))
      .expect(200);
    expect(adminTree.body.data[0].children[0]).toMatchObject({
      id: phones.id,
      status: CATALOG_STATUS.INACTIVE,
    });
  });

  it("creates brands and attributes atomically and rejects duplicate identifiers and invalid variant axes", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();

    const brand = await createBrandViaHttp(adminToken, {
      slug: "  ACME  ",
      name: " Acme ",
    });
    expect(brand).toMatchObject({ slug: "acme", name: "Acme" });

    const duplicateBrand = await request(app)
      .post("/api/v1/admin/catalog/brands")
      .set(bearer(adminToken))
      .send({ slug: "acme", name: "Another Acme" })
      .expect(409);
    expect(duplicateBrand.body.error.code).toBe(CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE);

    const size = await createAttributeViaHttp(adminToken, {
      code: "size",
      name: "Size",
      dataType: "option",
      isVariantAxis: true,
      values: [
        { value: "Small", sortOrder: 1 },
        { value: "Large", sortOrder: 2 },
      ],
    });
    expect(size.values).toHaveLength(2);

    const invalidAxis = await request(app)
      .post("/api/v1/admin/catalog/attributes")
      .set(bearer(adminToken))
      .send({ code: "empty-axis", name: "Empty Axis", dataType: "option", isVariantAxis: true })
      .expect(422);
    expect(invalidAxis.body.error.code).toBe(
      CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
    );

    const duplicateValues = await request(app)
      .post("/api/v1/admin/catalog/attributes")
      .set(bearer(adminToken))
      .send({
        code: "duplicate-values",
        name: "Duplicate Values",
        dataType: "option",
        values: [{ value: "Red" }, { value: " red " }],
      })
      .expect(422);
    expect(duplicateValues.body.error.code).toBe(ERROR_CODE.INVALID_REQUEST);

    const inactiveBrand = await createBrandViaHttp(adminToken, {
      slug: "archived-brand",
      name: "Archived Brand",
      status: CATALOG_STATUS.INACTIVE,
    });
    const inactiveAttribute = await createAttributeViaHttp(adminToken, {
      code: "archived-attribute",
      name: "Archived Attribute",
      dataType: "text",
      status: CATALOG_STATUS.INACTIVE,
    });

    const publicBrands = await request(app).get("/api/v1/catalog/brands").expect(200);
    expect(publicBrands.body.data.map((item: { id: string }) => item.id)).toEqual([
      brand.id,
    ]);
    const publicAttributes = await request(app)
      .get("/api/v1/catalog/attributes")
      .expect(200);
    expect(publicAttributes.body.data.map((item: { id: string }) => item.id)).toEqual([
      size.id,
    ]);

    const managerBrands = await request(app)
      .get("/api/v1/catalog/brands")
      .set(bearer(adminToken))
      .expect(200);
    expect(managerBrands.body.data.map((item: { id: string }) => item.id)).toContain(
      inactiveBrand.id,
    );
    const managerAttributes = await request(app)
      .get("/api/v1/catalog/attributes")
      .set(bearer(adminToken))
      .expect(200);
    expect(
      managerAttributes.body.data.map((item: { id: string }) => item.id),
    ).toContain(inactiveAttribute.id);
  });

  it("replaces category attribute mappings atomically and preserves the previous mapping when validation fails", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();
    const category = await createCategoryViaHttp(adminToken, { slug: "shoes", name: "Shoes" });
    const size = await createAttributeViaHttp(adminToken, {
      code: "size",
      name: "Size",
      dataType: "option",
      values: [{ value: "8" }, { value: "9" }],
    });
    const color = await createAttributeViaHttp(adminToken, {
      code: "color",
      name: "Color",
      dataType: "option",
      values: [{ value: "Black" }, { value: "White" }],
    });

    const replaced = await request(app)
      .put(`/api/v1/admin/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .send({
        attributes: [
          { attributeId: size.id, isRequired: true, isFilterable: true, sortOrder: 1 },
          { attributeId: color.id, isRequired: false, isFilterable: true, sortOrder: 2 },
        ],
      })
      .expect(200);
    expect(replaced.body.data.map((item: { attributeId: string }) => item.attributeId)).toEqual([
      size.id,
      color.id,
    ]);

    const invalid = await request(app)
      .put(`/api/v1/admin/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .send({ attributes: [{ attributeId: randomUUID(), isRequired: true }] })
      .expect(422);
    expect(invalid.body.error.code).toBe(CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY);

    const persisted = await databasePool.query<{ attribute_id: string }>(
      `select attribute_id::text as attribute_id
         from category_attributes
        where category_id = $1
        order by sort_order, attribute_id`,
      [category.id],
    );
    expect(persisted.rows.map((row) => row.attribute_id)).toEqual([size.id, color.id]);
    expect(await countCatalogOutboxEvents(CATALOG_OUTBOX_EVENT.CATEGORY_ATTRIBUTES_CHANGED)).toBe(1);
    expect(await countCatalogAuditActions(CATALOG_AUDIT_ACTION.CATEGORY_ATTRIBUTES_REPLACED)).toBe(1);
  });

  it("reads category mappings through HTTP and hides inactive mapped attributes from public readers", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();
    const category = await createCategoryViaHttp(adminToken, {
      slug: "mapping-read",
      name: "Mapping Read",
    });
    const size = await createAttributeViaHttp(adminToken, {
      code: "mapping-size",
      name: "Mapping Size",
      dataType: "option",
      values: [{ value: "M" }],
    });
    const archivedColor = await createAttributeViaHttp(adminToken, {
      code: "mapping-color",
      name: "Mapping Color",
      dataType: "option",
      values: [{ value: "Black" }],
    });

    await request(app)
      .put(`/api/v1/admin/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .send({
        attributes: [
          {
            attributeId: size.id,
            isRequired: true,
            isFilterable: true,
            sortOrder: 1,
          },
          {
            attributeId: archivedColor.id,
            isRequired: false,
            isFilterable: true,
            sortOrder: 2,
          },
        ],
      })
      .expect(200);

    await databasePool.query(
      "update attributes set status = $1 where id = $2",
      [CATALOG_STATUS.INACTIVE, archivedColor.id],
    );

    const publicRead = await request(app)
      .get(`/api/v1/catalog/categories/${category.id}/attributes`)
      .expect(200);
    expect(
      publicRead.body.data.map(
        (item: { attributeId: string }) => item.attributeId,
      ),
    ).toEqual([size.id]);

    const managerRead = await request(app)
      .get(`/api/v1/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .expect(200);
    expect(
      managerRead.body.data.map(
        (item: { attributeId: string }) => item.attributeId,
      ),
    ).toEqual([size.id, archivedColor.id]);

    await request(app)
      .get("/api/v1/catalog/categories/not-a-uuid/attributes")
      .expect(422);
    await request(app)
      .get(`/api/v1/catalog/categories/${randomUUID()}/attributes`)
      .expect(404);
  });

  it("allows an approved seller to read taxonomy but never grants catalog mutation permissions", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createApprovedSeller(adminToken, "module5-catalog-reader");
    const app = createApp();
    await createCategoryViaHttp(adminToken, { slug: "seller-visible", name: "Seller Visible" });

    const readable = await request(app)
      .get("/api/v1/catalog/categories")
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(readable.body.data[0]).toMatchObject({ slug: "seller-visible" });

    const forbidden = await request(app)
      .post("/api/v1/admin/catalog/categories")
      .set(bearer(seller.ownerToken))
      .send({ slug: "seller-created", name: "Seller Created" })
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
  });

  it("keeps the global catalog read-only across two independent seller scopes", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createApprovedSeller(adminToken, "module5-seller-a");
    const sellerB = await createApprovedSeller(adminToken, "module5-seller-b");
    const app = createApp();

    const activeCategory = await createCategoryViaHttp(adminToken, {
      slug: "seller-shared-active",
      name: "Seller Shared Active",
    });
    const inactiveCategory = await createCategoryViaHttp(adminToken, {
      slug: "seller-shared-inactive",
      name: "Seller Shared Inactive",
    });
    await request(app)
      .patch(`/api/v1/admin/catalog/categories/${inactiveCategory.id}`)
      .set(bearer(adminToken))
      .send({ status: CATALOG_STATUS.INACTIVE })
      .expect(200);

    for (const sellerToken of [sellerA.ownerToken, sellerB.ownerToken]) {
      const readable = await request(app)
        .get("/api/v1/catalog/categories")
        .set(bearer(sellerToken))
        .expect(200);
      expect(readable.body.data.map((item: { id: string }) => item.id)).toContain(
        activeCategory.id,
      );
      expect(readable.body.data.map((item: { id: string }) => item.id)).not.toContain(
        inactiveCategory.id,
      );

      await request(app)
        .post("/api/v1/admin/catalog/categories")
        .set(bearer(sellerToken))
        .send({ slug: `forbidden-${randomUUID()}`, name: "Forbidden Category" })
        .expect(403);
      await request(app)
        .post("/api/v1/admin/catalog/brands")
        .set(bearer(sellerToken))
        .send({ slug: `forbidden-${randomUUID()}`, name: "Forbidden Brand" })
        .expect(403);
      await request(app)
        .post("/api/v1/admin/catalog/attributes")
        .set(bearer(sellerToken))
        .send({
          code: `forbidden-${randomUUID()}`,
          name: "Forbidden Attribute",
          dataType: "option",
        })
        .expect(403);
      await request(app)
        .put(`/api/v1/admin/catalog/categories/${activeCategory.id}/attributes`)
        .set(bearer(sellerToken))
        .send({ attributes: [] })
        .expect(403);
    }

    const categoryCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from categories",
    );
    expect(categoryCount.rows[0]?.count).toBe(2);
  });

  it("fails repeated create retries without duplicating catalog rows, audit rows, or outbox events", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();

    const category = await createCategoryViaHttp(adminToken, {
      slug: "retry-safe-category",
      name: "Retry Safe Category",
    });

    const retryCategory = await request(app)
      .post("/api/v1/admin/catalog/categories")
      .set(bearer(adminToken))
      .send({ slug: "retry-safe-category", name: "Retry Safe Category" })
      .expect(409);
    expect(retryCategory.body.error.code).toBe(
      CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE,
    );

    const attribute = await createAttributeViaHttp(adminToken, {
      code: "retry-safe-attribute",
      name: "Retry Safe Attribute",
      dataType: "option",
      values: [{ value: "One" }, { value: "Two" }],
    });
    const retryAttribute = await request(app)
      .post("/api/v1/admin/catalog/attributes")
      .set(bearer(adminToken))
      .send({
        code: "retry-safe-attribute",
        name: "Retry Safe Attribute",
        dataType: "option",
        values: [{ value: "One" }, { value: "Two" }],
      })
      .expect(409);
    expect(retryAttribute.body.error.code).toBe(
      CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE,
    );

    const categoryRows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from categories where id = $1 and slug = $2",
      [category.id, "retry-safe-category"],
    );
    const attributeRows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from attributes where code = $1",
      ["retry-safe-attribute"],
    );
    const valueRows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from attribute_values where attribute_id = $1",
      [attribute.id],
    );

    expect(categoryRows.rows[0]?.count).toBe(1);
    expect(attributeRows.rows[0]?.count).toBe(1);
    expect(valueRows.rows[0]?.count).toBe(2);
    expect(await countCatalogAuditActions(CATALOG_AUDIT_ACTION.CATEGORY_CREATED)).toBe(1);
    expect(await countCatalogOutboxEvents(CATALOG_OUTBOX_EVENT.CATEGORY_CREATED)).toBe(1);
    expect(await countCatalogAuditActions(CATALOG_AUDIT_ACTION.ATTRIBUTE_CREATED)).toBe(1);
    expect(await countCatalogOutboxEvents(CATALOG_OUTBOX_EVENT.ATTRIBUTE_UPDATED)).toBe(1);
  });

  it("keeps inactive or invalid taxonomy out of the later Product publication boundary", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();
    const category = await createCategoryViaHttp(adminToken, { slug: "apparel", name: "Apparel" });
    const size = await createAttributeViaHttp(adminToken, {
      code: "size",
      name: "Size",
      dataType: "option",
      isVariantAxis: true,
      values: [{ value: "M" }],
    });
    await request(app)
      .put(`/api/v1/admin/catalog/categories/${category.id}/attributes`)
      .set(bearer(adminToken))
      .send({ attributes: [{ attributeId: size.id, isRequired: true, isFilterable: true }] })
      .expect(200);

    const service = new CatalogTaxonomyService();
    const sizeValueId = String(size.values[0]?.id);
    await expect(
      service.assertProductTaxonomyPublicationIsValid({
        categoryId: String(category.id),
        productAttributes: [],
        variants: [
          {
            variantId: randomUUID(),
            attributes: [{ attributeId: String(size.id), valueId: sizeValueId }],
          },
        ],
      }),
    ).resolves.toBeUndefined();

    await request(app)
      .patch(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(bearer(adminToken))
      .send({ status: CATALOG_STATUS.INACTIVE })
      .expect(200);

    await expect(
      service.assertProductTaxonomyPublicationIsValid({
        categoryId: String(category.id),
        productAttributes: [],
        variants: [
          {
            variantId: randomUUID(),
            attributes: [{ attributeId: String(size.id), valueId: sizeValueId }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects Product publication when an active category belongs to an inactive ancestor branch", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const parent = await createCategoryViaHttp(adminToken, {
      slug: "archived-parent",
      name: "Archived Parent",
    });
    const child = await createCategoryViaHttp(adminToken, {
      parentId: parent.id,
      slug: "active-child",
      name: "Active Child",
    });

    await request(createApp())
      .patch(`/api/v1/admin/catalog/categories/${parent.id}`)
      .set(bearer(adminToken))
      .send({ status: CATALOG_STATUS.INACTIVE })
      .expect(200);

    const service = new CatalogTaxonomyService();
    await expect(
      service.assertProductTaxonomyPublicationIsValid({
        categoryId: String(child.id),
        productAttributes: [],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("publishes the eight source-defined operations plus the approved mapping-read operation with no generic CRUD additions", async () => {
    const response = await request(createApp()).get("/openapi.json").expect(200);
    const paths = response.body.paths as Record<string, Record<string, unknown>>;
    const expected: Record<string, string[]> = {
      "/api/v1/catalog/categories": ["get"],
      "/api/v1/catalog/categories/{id}/attributes": ["get"],
      "/api/v1/admin/catalog/categories": ["post"],
      "/api/v1/admin/catalog/categories/{id}": ["patch"],
      "/api/v1/catalog/brands": ["get"],
      "/api/v1/admin/catalog/brands": ["post"],
      "/api/v1/catalog/attributes": ["get"],
      "/api/v1/admin/catalog/attributes": ["post"],
      "/api/v1/admin/catalog/categories/{id}/attributes": ["put"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      expect(openApiMethods(paths[path])).toEqual(methods.sort());
    }

    const module5Operations = Object.entries(paths)
      .flatMap(([path, pathItem]) =>
        openApiMethods(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .filter((operation) => operation.includes("/api/v1/catalog") || operation.includes("/api/v1/admin/catalog"))
      .sort();
    const expectedOperations = Object.entries(expected)
      .flatMap(([path, methods]) => methods.map((method) => `${method.toUpperCase()} ${path}`))
      .sort();
    expect(module5Operations).toEqual(expectedOperations);

    const app = createApp();
    await request(app).delete(`/api/v1/admin/catalog/categories/${randomUUID()}`).expect(404);
    await request(app).patch(`/api/v1/admin/catalog/brands/${randomUUID()}`).expect(404);
    await request(app).delete(`/api/v1/admin/catalog/attributes/${randomUUID()}`).expect(404);
  });
});
