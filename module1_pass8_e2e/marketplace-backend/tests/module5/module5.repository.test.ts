import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import { CATALOG_STATUS } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.constants.js";
import { CatalogTaxonomyRepository } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.repository.js";
import { resetModule5Tables } from "./module5.test-helpers.js";

beforeEach(async () => {
  await resetModule5Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 5 repository persistence", () => {
  it("persists categories and returns them in deterministic sort/name order", async () => {
    const repository = new CatalogTaxonomyRepository();
    const second = await repository.createCategory({
      slug: `z-${randomUUID()}`,
      name: "Zeta",
      sortOrder: 2,
    });
    const first = await repository.createCategory({
      slug: `a-${randomUUID()}`,
      name: "Alpha",
      sortOrder: 1,
    });

    const rows = await repository.listCategories();
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(await repository.findCategoryIdBySlug(first.slug)).toBe(first.id);
  });

  it("filters public brand and attribute reads by persisted status", async () => {
    const repository = new CatalogTaxonomyRepository();
    const activeBrand = await repository.createBrand({ slug: "active-brand", name: "Active" });
    await repository.createBrand({
      slug: "inactive-brand",
      name: "Inactive",
      status: CATALOG_STATUS.INACTIVE,
    });
    const activeAttribute = await repository.createAttribute({
      code: "size",
      name: "Size",
      dataType: "option",
    });
    await repository.createAttribute({
      code: "legacy",
      name: "Legacy",
      dataType: "text",
      status: CATALOG_STATUS.INACTIVE,
    });

    expect(
      (await repository.listBrands({ status: CATALOG_STATUS.ACTIVE })).map((row) => row.id),
    ).toEqual([activeBrand.id]);
    expect(
      (await repository.listAttributes({ status: CATALOG_STATUS.ACTIVE })).map(
        (row) => row.id,
      ),
    ).toEqual([activeAttribute.id]);
  });

  it("supports the exact lookup helpers used by the service and returns missing records as null", async () => {
    const repository = new CatalogTaxonomyRepository();
    const category = await repository.createCategory({
      slug: "lookup-category",
      name: "Lookup Category",
    });
    const brand = await repository.createBrand({
      slug: "lookup-brand",
      name: "Lookup Brand",
    });
    const attribute = await repository.createAttribute({
      code: "lookup-attribute",
      name: "Lookup Attribute",
      dataType: "option",
    });

    expect(await repository.findCategoryById(category.id)).toMatchObject({
      id: category.id,
    });
    expect(await repository.findBrandById(brand.id)).toMatchObject({
      id: brand.id,
    });
    expect(await repository.findBrandIdBySlug(brand.slug)).toBe(brand.id);
    expect(await repository.findAttributeIdByCode(attribute.code)).toBe(
      attribute.id,
    );
    expect((await repository.listAttributesByIds([attribute.id])).map((row) => row.id)).toEqual([
      attribute.id,
    ]);

    const renamed = await repository.updateCategory(category.id, {
      name: "Renamed Category",
    });
    expect(renamed).toMatchObject({ id: category.id, name: "Renamed Category" });

    expect(await repository.findCategoryById(randomUUID())).toBeNull();
    expect(await repository.findBrandById(randomUUID())).toBeNull();
    expect(await repository.findBrandIdBySlug("missing-brand")).toBeNull();
    expect(await repository.findAttributeIdByCode("missing-attribute")).toBeNull();
    expect(await repository.listAttributesByIds([])).toEqual([]);
    expect(await repository.listAttributeValuesByAttributeIds([])).toEqual([]);
  });

  it("loads attribute values in one batched read and replaces one category mapping set", async () => {
    const repository = new CatalogTaxonomyRepository();
    const category = await repository.createCategory({ slug: "shoes", name: "Shoes" });
    const size = await repository.createAttribute({
      code: "size",
      name: "Size",
      dataType: "option",
      isVariantAxis: true,
    });
    const color = await repository.createAttribute({
      code: "color",
      name: "Color",
      dataType: "option",
    });
    await repository.createAttributeValues(size.id, [
      { value: "Small", sortOrder: 1 },
      { value: "Large", sortOrder: 2 },
    ]);

    const values = await repository.listAttributeValuesByAttributeIds([size.id, color.id]);
    expect(values.map((row) => row.value)).toEqual(["Small", "Large"]);

    await repository.replaceCategoryAttributes(category.id, [
      { attributeId: size.id, isRequired: true, isFilterable: true, sortOrder: 1 },
      { attributeId: color.id, isRequired: false, isFilterable: true, sortOrder: 2 },
    ]);
    expect((await repository.listCategoryAttributes(category.id)).map((row) => row.attributeId)).toEqual([
      size.id,
      color.id,
    ]);

    await repository.replaceCategoryAttributes(category.id, [
      { attributeId: color.id, isRequired: true, isFilterable: true, sortOrder: 0 },
    ]);
    const replaced = await repository.listCategoryAttributes(category.id);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ attributeId: color.id, isRequired: true });
  });
});
