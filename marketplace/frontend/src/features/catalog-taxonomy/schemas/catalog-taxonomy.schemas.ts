import { z } from "zod";
import { CATALOG_LIMITS } from "../catalog-taxonomy.constants";

/** Validates shared category fields used by create and edit screens. */
export const categoryEditorFormSchema = z.object({
  parentId: z.union([z.literal(""), z.uuid()]),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Category slug is required")
    .max(CATALOG_LIMITS.CATEGORY_SLUG_MAX_LENGTH),
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(CATALOG_LIMITS.CATEGORY_NAME_MAX_LENGTH),
  status: z.enum(["active", "inactive"]),
  sortOrder: z.number().int().nonnegative("Sort order cannot be negative"),
});

/** Validates the create-brand form using the backend-owned normalized slug contract. */
export const brandFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Brand slug is required")
    .max(CATALOG_LIMITS.BRAND_SLUG_MAX_LENGTH),
  name: z
    .string()
    .trim()
    .min(1, "Brand name is required")
    .max(CATALOG_LIMITS.BRAND_NAME_MAX_LENGTH),
  status: z.enum(["active", "inactive"]),
});

/** Splits the value-option textarea into normalized non-empty lines. */
export function attributeValueLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Validates attribute creation without inventing a data-type enum absent from the controlling guide. */
export const attributeFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Attribute code is required")
      .max(CATALOG_LIMITS.ATTRIBUTE_CODE_MAX_LENGTH),
    name: z
      .string()
      .trim()
      .min(1, "Attribute name is required")
      .max(CATALOG_LIMITS.ATTRIBUTE_NAME_MAX_LENGTH),
    dataType: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Data type is required")
      .max(CATALOG_LIMITS.ATTRIBUTE_DATA_TYPE_MAX_LENGTH),
    isVariantAxis: z.boolean(),
    status: z.enum(["active", "inactive"]),
    valuesText: z.string(),
  })
  .superRefine((value, context) => {
    const values = attributeValueLines(value.valuesText);
    const normalized = values.map((item) => item.toLowerCase());

    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["valuesText"],
        message: "Attribute values must be unique.",
      });
    }

    if (values.some((item) => item.length > CATALOG_LIMITS.ATTRIBUTE_VALUE_MAX_LENGTH)) {
      context.addIssue({
        code: "custom",
        path: ["valuesText"],
        message: `Each value must be ${CATALOG_LIMITS.ATTRIBUTE_VALUE_MAX_LENGTH} characters or fewer.`,
      });
    }

    if (value.isVariantAxis && value.dataType !== "option") {
      context.addIssue({
        code: "custom",
        path: ["dataType"],
        message: 'Variant-axis attributes use the "option" data type.',
      });
    }

    if (value.isVariantAxis && values.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["valuesText"],
        message: "Variant-axis attributes need at least one allowed value.",
      });
    }
  });

/** One editable row used by the complete category-attribute replacement form. */
export const categoryAttributeDraftSchema = z.object({
  attributeId: z.uuid(),
  selected: z.boolean(),
  isRequired: z.boolean(),
  isFilterable: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});

/** Validates one deliberate full-replacement command for a selected category. */
export const categoryAttributeReplacementFormSchema = z.object({
  categoryId: z.uuid("Choose a category."),
  attributes: z.array(categoryAttributeDraftSchema),
  confirmReplacement: z.boolean().refine((value) => value, {
    message: "Confirm that this command replaces the complete mapping.",
  }),
});
