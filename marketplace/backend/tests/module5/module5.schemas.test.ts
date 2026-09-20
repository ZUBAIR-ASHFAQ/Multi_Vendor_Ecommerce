import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { catalogTaxonomyOpenApiPaths } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.routes.js";
import {
  createAttributeBodySchema,
  createBrandBodySchema,
  createCategoryBodySchema,
  replaceCategoryAttributesBodySchema,
  updateCategoryBodySchema,
} from "../../src/modules/catalog-taxonomy/catalog-taxonomy.schema.js";

/** Returns one valid attribute mapping item for focused schema tests. */
function validMapping(attributeId = randomUUID()) {
  return {
    attributeId,
    isRequired: true,
    isFilterable: true,
    sortOrder: 1,
  };
}

/** Returns the JSON schema stored on one OpenAPI request body. */
function requestBodySchema(path: string, method: "post" | "patch" | "put") {
  const operation = catalogTaxonomyOpenApiPaths[
    path as keyof typeof catalogTaxonomyOpenApiPaths
  ] as unknown as Record<
    string,
    { requestBody: { content: { "application/json": { schema: Record<string, unknown> } } } }
  >;
  return operation[method]?.requestBody.content["application/json"].schema ?? {};
}

/** Narrows one OpenAPI schema value to an object before nested assertions. */
function schemaObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

describe("Module 5 Zod and OpenAPI contracts", () => {
  it("normalizes category and brand identifiers while rejecting server-owned fields", () => {
    expect(
      createCategoryBodySchema.parse({
        slug: "  Mobile-Phones  ",
        name: "  Mobile Phones  ",
      }),
    ).toMatchObject({ slug: "mobile-phones", name: "Mobile Phones" });

    expect(
      createBrandBodySchema.parse({ slug: "  ACME  ", name: "  Acme  " }),
    ).toMatchObject({ slug: "acme", name: "Acme" });

    expect(() =>
      createCategoryBodySchema.parse({
        slug: "phones",
        name: "Phones",
        createdBy: randomUUID(),
      }),
    ).toThrow();
  });

  it("requires a non-empty category patch and accepts only active or inactive lifecycle states", () => {
    expect(() => updateCategoryBodySchema.parse({})).toThrow();
    expect(updateCategoryBodySchema.parse({ status: "inactive" })).toEqual({
      status: "inactive",
    });
    expect(() => updateCategoryBodySchema.parse({ status: "deleted" })).toThrow();
  });

  it("normalizes attribute code and data type without inventing an undocumented data-type enum", () => {
    const parsed = createAttributeBodySchema.parse({
      code: "  Screen-Size  ",
      name: " Screen Size ",
      dataType: "  Custom-Token  ",
      values: [{ value: "  Large  " }],
    });

    expect(parsed).toMatchObject({
      code: "screen-size",
      name: "Screen Size",
      dataType: "custom-token",
    });
    expect(parsed.values?.[0]?.value).toBe("Large");
  });

  it("rejects duplicate attribute values at the request boundary", () => {
    expect(() =>
      createAttributeBodySchema.parse({
        code: "color",
        name: "Color",
        dataType: "option",
        values: [{ value: "Red" }, { value: " red " }],
      }),
    ).toThrow(/Attribute values must be unique/);
  });

  it("rejects duplicate category attribute IDs at the request boundary", () => {
    const attributeId = randomUUID();
    expect(() =>
      replaceCategoryAttributesBodySchema.parse({
        attributes: [validMapping(attributeId), validMapping(attributeId)],
      }),
    ).toThrow(/Each attribute may appear only once/);
  });

  it("keeps OpenAPI write schemas derived from the same Zod contracts", () => {
    const createCategoryOpenApi = requestBodySchema(
      "/api/v1/admin/catalog/categories",
      "post",
    );
    const updateCategoryOpenApi = requestBodySchema(
      "/api/v1/admin/catalog/categories/{id}",
      "patch",
    );
    const createAttributeOpenApi = requestBodySchema(
      "/api/v1/admin/catalog/attributes",
      "post",
    );

    expect(schemaObject(createCategoryOpenApi.properties).slug).toBeTruthy();
    expect(createCategoryOpenApi.additionalProperties).toBe(false);
    expect(updateCategoryOpenApi.minProperties).toBe(1);
    const attributeProperties = schemaObject(createAttributeOpenApi.properties);
    const valuesSchema = schemaObject(attributeProperties.values);
    const itemsSchema = schemaObject(valuesSchema.items);
    expect(schemaObject(itemsSchema.properties).value).toBeTruthy();

    const createAttributeOperation =
      catalogTaxonomyOpenApiPaths["/api/v1/admin/catalog/attributes"].post;
    expect(createAttributeOperation.responses["422"]).toBeTruthy();
    expect("400" in createAttributeOperation.responses).toBe(false);
  });
});
