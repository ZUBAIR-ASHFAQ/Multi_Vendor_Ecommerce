import { z } from "zod";
import { uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  CATALOG_LIMITS,
  CATALOG_STATUS_VALUES,
} from "./catalog-taxonomy.constants.js";

/** Creates one trimmed non-blank string contract aligned to a database text limit. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Creates one lowercase persisted identifier contract without inventing semantics not defined by the guide. */
function normalizedLowercaseString(maxLength: number) {
  return z.string().trim().toLowerCase().min(1).max(maxLength);
}

/** Creates one non-negative integer ordering contract shared by taxonomy write inputs. */
function sortOrderSchema() {
  return z.number().int().nonnegative();
}

/** Active/inactive lifecycle state shared by Module 5 taxonomy records. */
export const catalogStatusSchema = z.enum(CATALOG_STATUS_VALUES);

/** Category slug normalized exactly like the persisted lowercase/trimmed database value. */
export const categorySlugSchema = normalizedLowercaseString(
  CATALOG_LIMITS.CATEGORY_SLUG_MAX_LENGTH,
);

/** Brand slug normalized exactly like the persisted lowercase/trimmed database value. */
export const brandSlugSchema = normalizedLowercaseString(
  CATALOG_LIMITS.BRAND_SLUG_MAX_LENGTH,
);

/** Attribute code normalized exactly like the persisted lowercase/trimmed database value. */
export const attributeCodeSchema = normalizedLowercaseString(
  CATALOG_LIMITS.ATTRIBUTE_CODE_MAX_LENGTH,
);

/** Attribute data-type token; semantic compatibility is deliberately enforced by the service rather than guessed here. */
export const attributeDataTypeSchema = normalizedLowercaseString(
  CATALOG_LIMITS.ATTRIBUTE_DATA_TYPE_MAX_LENGTH,
);

/** One allowed value option supplied while creating an attribute definition. */
export const createAttributeValueSchema = z
  .object({
    value: nonBlankString(CATALOG_LIMITS.ATTRIBUTE_VALUE_MAX_LENGTH),
    sortOrder: sortOrderSchema().optional(),
    status: catalogStatusSchema.optional(),
  })
  .strict();

/** Request body for POST /api/v1/admin/catalog/categories. */
export const createCategoryBodySchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    slug: categorySlugSchema,
    name: nonBlankString(CATALOG_LIMITS.CATEGORY_NAME_MAX_LENGTH),
    status: catalogStatusSchema.optional(),
    sortOrder: sortOrderSchema().optional(),
  })
  .strict();

/** Path parameter used by category update and category-to-attribute replacement commands. */
export const categoryIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Request body for PATCH /api/v1/admin/catalog/categories/:id. */
export const updateCategoryBodySchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    slug: categorySlugSchema.optional(),
    name: nonBlankString(CATALOG_LIMITS.CATEGORY_NAME_MAX_LENGTH).optional(),
    status: catalogStatusSchema.optional(),
    sortOrder: sortOrderSchema().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable category field is required",
  })
  .meta({ minProperties: 1 });

/** Request body for POST /api/v1/admin/catalog/brands. */
export const createBrandBodySchema = z
  .object({
    slug: brandSlugSchema,
    name: nonBlankString(CATALOG_LIMITS.BRAND_NAME_MAX_LENGTH),
    status: catalogStatusSchema.optional(),
  })
  .strict();

/** Request body for POST /api/v1/admin/catalog/attributes. */
export const createAttributeBodySchema = z
  .object({
    code: attributeCodeSchema,
    name: nonBlankString(CATALOG_LIMITS.ATTRIBUTE_NAME_MAX_LENGTH),
    dataType: attributeDataTypeSchema,
    isVariantAxis: z.boolean().optional(),
    status: catalogStatusSchema.optional(),
    values: z.array(createAttributeValueSchema).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const normalizedValues = (value.values ?? []).map((item) =>
      item.value.trim().toLowerCase(),
    );

    if (new Set(normalizedValues).size !== normalizedValues.length) {
      context.addIssue({
        code: "custom",
        message: "Attribute values must be unique.",
        path: ["values"],
      });
    }
  });

/** One category-to-attribute rule supplied by the replacement command. */
export const categoryAttributeMappingInputSchema = z
  .object({
    attributeId: uuidSchema,
    isRequired: z.boolean().optional(),
    isFilterable: z.boolean().optional(),
    sortOrder: sortOrderSchema().optional(),
  })
  .strict();

/** Request body for PUT /api/v1/admin/catalog/categories/:id/attributes. */
export const replaceCategoryAttributesBodySchema = z
  .object({
    attributes: z.array(categoryAttributeMappingInputSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const seenAttributeIds = new Set<string>();

    value.attributes.forEach((mapping, index) => {
      if (seenAttributeIds.has(mapping.attributeId)) {
        context.addIssue({
          code: "custom",
          message: "Each attribute may appear only once in a category mapping",
          path: ["attributes", index, "attributeId"],
        });
      }
      seenAttributeIds.add(mapping.attributeId);
    });
  });

/** Flat safe category representation reused inside the recursive category tree contract. */
export const categoryResponseSchema = z
  .object({
    id: uuidSchema,
    parentId: uuidSchema.nullable(),
    slug: z.string().min(1).max(CATALOG_LIMITS.CATEGORY_SLUG_MAX_LENGTH),
    name: z.string().min(1).max(CATALOG_LIMITS.CATEGORY_NAME_MAX_LENGTH),
    status: catalogStatusSchema,
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

/** Recursive response type for GET /api/v1/catalog/categories. */
export type CategoryTreeNodeResponse = z.infer<typeof categoryResponseSchema> & {
  children: CategoryTreeNodeResponse[];
};

/** Recursive category tree node returned by the public/authorized taxonomy read route. */
export const categoryTreeNodeResponseSchema: z.ZodType<CategoryTreeNodeResponse> =
  categoryResponseSchema.extend({
    children: z.lazy(() => z.array(categoryTreeNodeResponseSchema)),
  });

/** Safe brand representation returned by catalog read and administration commands. */
export const brandResponseSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().min(1).max(CATALOG_LIMITS.BRAND_SLUG_MAX_LENGTH),
    name: z.string().min(1).max(CATALOG_LIMITS.BRAND_NAME_MAX_LENGTH),
    status: catalogStatusSchema,
  })
  .strict();

/** Safe attribute-value representation nested under an attribute definition. */
export const attributeValueResponseSchema = z
  .object({
    id: uuidSchema,
    attributeId: uuidSchema,
    value: z.string().min(1).max(CATALOG_LIMITS.ATTRIBUTE_VALUE_MAX_LENGTH),
    sortOrder: z.number().int().nonnegative(),
    status: catalogStatusSchema,
  })
  .strict();

/** Safe reusable attribute representation returned by GET /api/v1/catalog/attributes. */
export const attributeResponseSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1).max(CATALOG_LIMITS.ATTRIBUTE_CODE_MAX_LENGTH),
    name: z.string().min(1).max(CATALOG_LIMITS.ATTRIBUTE_NAME_MAX_LENGTH),
    dataType: z.string().min(1).max(CATALOG_LIMITS.ATTRIBUTE_DATA_TYPE_MAX_LENGTH),
    isVariantAxis: z.boolean(),
    status: catalogStatusSchema,
    values: z.array(attributeValueResponseSchema),
  })
  .strict();

/** Safe category-to-attribute mapping returned to administration and later product workflows. */
export const categoryAttributeMappingResponseSchema = z
  .object({
    categoryId: uuidSchema,
    attributeId: uuidSchema,
    isRequired: z.boolean(),
    isFilterable: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategoryBodySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryBodySchema>;
export type CreateBrandInput = z.infer<typeof createBrandBodySchema>;
export type CreateAttributeInput = z.infer<typeof createAttributeBodySchema>;
export type ReplaceCategoryAttributesInput = z.infer<
  typeof replaceCategoryAttributesBodySchema
>;
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
export type BrandResponse = z.infer<typeof brandResponseSchema>;
export type AttributeValueResponse = z.infer<typeof attributeValueResponseSchema>;
export type AttributeResponse = z.infer<typeof attributeResponseSchema>;
export type CategoryAttributeMappingResponse = z.infer<
  typeof categoryAttributeMappingResponseSchema
>;
