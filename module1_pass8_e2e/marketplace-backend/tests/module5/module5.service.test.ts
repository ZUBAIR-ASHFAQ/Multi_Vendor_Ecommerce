import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  CATALOG_ERROR_CODE,
  CATALOG_PERMISSION,
  CATALOG_STATUS,
  CATALOG_VARIANT_AXIS_DATA_TYPE,
} from "../../src/modules/catalog-taxonomy/catalog-taxonomy.constants.js";
import { CatalogTaxonomyRepository } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.repository.js";
import { CatalogTaxonomyService } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.service.js";

/** Builds one small server-derived request context for Module 5 service policy tests. */
function testContext(permissions: readonly PermissionCode[]): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates one repository-shaped test double without introducing production test hooks. */
function repositoryStub(
  overrides: Partial<Record<keyof CatalogTaxonomyRepository, unknown>> = {},
): CatalogTaxonomyRepository {
  return {
    listCategories: vi.fn().mockResolvedValue([]),
    listBrands: vi.fn().mockResolvedValue([]),
    listAttributes: vi.fn().mockResolvedValue([]),
    listAttributeValuesByAttributeIds: vi.fn().mockResolvedValue([]),
    findCategoryById: vi.fn().mockResolvedValue(null),
    findBrandById: vi.fn().mockResolvedValue(null),
    listCategoryAttributes: vi.fn().mockResolvedValue([]),
    listAttributesByIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CatalogTaxonomyRepository;
}

/** Returns one persistence-shaped category row used by read-tree service tests. */
function categoryRow(
  id: string,
  name: string,
  parentId: string | null,
  status: (typeof CATALOG_STATUS)[keyof typeof CATALOG_STATUS] =
    CATALOG_STATUS.ACTIVE,
  sortOrder = 0,
) {
  return {
    id,
    parentId,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    name,
    status,
    sortOrder,
  };
}

describe("Module 5 service authorization and business guards", () => {
  it("rejects authenticated catalog reads when no catalog permission is present", async () => {
    const repository = repositoryStub();
    const service = new CatalogTaxonomyService({ repository });

    await expect(service.listBrands(testContext([]))).rejects.toMatchObject({
      code: ERROR_CODE.FORBIDDEN,
      statusCode: 403,
    });
    expect(repository.listBrands).not.toHaveBeenCalled();
  });

  it("rejects catalog writes before opening a transaction when the actor lacks the required permission", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const service = new CatalogTaxonomyService({ transactionRunner });

    await expect(
      service.createCategory(testContext([]), { slug: "phones", name: "Phones" }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.FORBIDDEN,
      statusCode: 403,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("filters inactive category branches for public readers while managers can inspect all states", async () => {
    const rootId = randomUUID();
    const activeChildId = randomUUID();
    const inactiveChildId = randomUUID();
    const repository = repositoryStub({
      listCategories: vi.fn().mockResolvedValue([
        categoryRow(rootId, "Electronics", null),
        categoryRow(activeChildId, "Phones", rootId, CATALOG_STATUS.ACTIVE, 1),
        categoryRow(inactiveChildId, "Legacy", rootId, CATALOG_STATUS.INACTIVE, 2),
      ]),
    });
    const service = new CatalogTaxonomyService({ repository });

    const publicTree = await service.listCategories(null);
    expect(publicTree[0]?.children.map((item) => item.id)).toEqual([activeChildId]);

    const managerTree = await service.listCategories(
      testContext([CATALOG_PERMISSION.MANAGE_CATEGORIES]),
    );
    expect(managerTree[0]?.children.map((item) => item.id)).toEqual([
      activeChildId,
      inactiveChildId,
    ]);
  });

  it("rejects a variant-axis attribute without value options before opening a transaction", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const service = new CatalogTaxonomyService({ transactionRunner });

    await expect(
      service.createAttribute(
        testContext([CATALOG_PERMISSION.MANAGE_ATTRIBUTES]),
        {
          code: "size",
          name: "Size",
          dataType: "option",
          isVariantAxis: true,
          values: [],
        },
      ),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
      statusCode: 422,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("rejects variant axes that do not use the project's value-backed option data type", async () => {
    const transactionRunner = vi.fn(async () => {
      throw new Error("transaction should not start");
    });
    const service = new CatalogTaxonomyService({ transactionRunner });

    await expect(
      service.createAttribute(
        testContext([CATALOG_PERMISSION.MANAGE_ATTRIBUTES]),
        {
          code: "size",
          name: "Size",
          dataType: "free-text",
          isVariantAxis: true,
          values: [{ value: "Large" }],
        },
      ),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
      statusCode: 422,
    });
    expect(CATALOG_VARIANT_AXIS_DATA_TYPE).toBe("option");
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("returns complete mappings to managers but hides inactive mapped attributes from read-only callers", async () => {
    const categoryId = randomUUID();
    const activeAttributeId = randomUUID();
    const inactiveAttributeId = randomUUID();
    const repository = repositoryStub({
      listCategories: vi.fn().mockResolvedValue([
        categoryRow(categoryId, "Shoes", null, CATALOG_STATUS.ACTIVE),
      ]),
      findCategoryById: vi.fn().mockResolvedValue(
        categoryRow(categoryId, "Shoes", null, CATALOG_STATUS.ACTIVE),
      ),
      listCategoryAttributes: vi.fn().mockResolvedValue([
        {
          categoryId,
          attributeId: activeAttributeId,
          isRequired: true,
          isFilterable: true,
          sortOrder: 1,
        },
        {
          categoryId,
          attributeId: inactiveAttributeId,
          isRequired: false,
          isFilterable: true,
          sortOrder: 2,
        },
      ]),
      listAttributesByIds: vi.fn().mockResolvedValue([
        {
          id: activeAttributeId,
          code: "size",
          name: "Size",
          dataType: "option",
          isVariantAxis: true,
          status: CATALOG_STATUS.ACTIVE,
        },
        {
          id: inactiveAttributeId,
          code: "legacy",
          name: "Legacy",
          dataType: "text",
          isVariantAxis: false,
          status: CATALOG_STATUS.INACTIVE,
        },
      ]),
    });
    const service = new CatalogTaxonomyService({ repository });

    const readerMappings = await service.listCategoryAttributeMappings(null, categoryId);
    expect(readerMappings.map((mapping) => mapping.attributeId)).toEqual([
      activeAttributeId,
    ]);

    const managerMappings = await service.listCategoryAttributeMappings(
      testContext([CATALOG_PERMISSION.MANAGE_CATEGORIES]),
      categoryId,
    );
    expect(managerMappings.map((mapping) => mapping.attributeId)).toEqual([
      activeAttributeId,
      inactiveAttributeId,
    ]);
  });

  it("rejects publication when an active child category has an inactive ancestor", async () => {
    const parentId = randomUUID();
    const childId = randomUUID();
    const repository = repositoryStub({
      listCategories: vi.fn().mockResolvedValue([
        categoryRow(parentId, "Archived", null, CATALOG_STATUS.INACTIVE),
        categoryRow(childId, "Shoes", parentId, CATALOG_STATUS.ACTIVE),
      ]),
    });
    const service = new CatalogTaxonomyService({ repository });

    await expect(
      service.assertProductTaxonomyValuesAreValid({
        categoryId: childId,
        productAttributes: [],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects Product publication when the selected brand is missing or inactive", async () => {
    const categoryId = randomUUID();
    const brandId = randomUUID();
    const findBrandById = vi.fn().mockResolvedValue({
      id: brandId,
      slug: "archived-brand",
      name: "Archived Brand",
      status: CATALOG_STATUS.INACTIVE,
    });
    const repository = repositoryStub({
      listCategories: vi.fn().mockResolvedValue([
        categoryRow(categoryId, "Shoes", null, CATALOG_STATUS.ACTIVE),
      ]),
      findBrandById,
    });
    const service = new CatalogTaxonomyService({ repository });

    await expect(
      service.assertProductTaxonomyValuesAreValid({
        categoryId,
        brandId,
        productAttributes: [],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.CONFLICT,
      statusCode: 409,
    });

    findBrandById.mockResolvedValue(null);
    await expect(
      service.assertProductTaxonomyValuesAreValid({
        categoryId,
        brandId,
        productAttributes: [],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.CONFLICT,
      statusCode: 409,
    });
  });

  it("validates required and category-scoped Product values before publication", async () => {
    const categoryId = randomUUID();
    const requiredAttributeId = randomUUID();
    const foreignAttributeId = randomUUID();
    const repository = repositoryStub({
      listCategories: vi.fn().mockResolvedValue([
        categoryRow(categoryId, "Shoes", null, CATALOG_STATUS.ACTIVE),
      ]),
      listCategoryAttributes: vi.fn().mockResolvedValue([
        {
          categoryId,
          attributeId: requiredAttributeId,
          isRequired: true,
          isFilterable: true,
          sortOrder: 0,
        },
      ]),
      listAttributesByIds: vi.fn().mockImplementation(async (ids: string[]) =>
        ids.includes(requiredAttributeId)
          ? [
              {
                id: requiredAttributeId,
                code: "material",
                name: "Material",
                dataType: "text",
                isVariantAxis: false,
                status: CATALOG_STATUS.ACTIVE,
              },
            ]
          : [],
      ),
    });
    const service = new CatalogTaxonomyService({ repository });

    await expect(
      service.assertProductTaxonomyPublicationIsValid({
        categoryId,
        productAttributes: [
          { attributeId: requiredAttributeId, valueText: "Cotton" },
        ],
        variants: [],
      }),
    ).resolves.toBeUndefined();

    await expect(
      service.assertProductTaxonomyPublicationIsValid({
        categoryId,
        productAttributes: [],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
      statusCode: 422,
    });

    await expect(
      service.assertProductTaxonomyValuesAreValid({
        categoryId,
        productAttributes: [
          { attributeId: foreignAttributeId, valueText: "Unknown" },
        ],
        variants: [],
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
      statusCode: 422,
    });
  });
});
