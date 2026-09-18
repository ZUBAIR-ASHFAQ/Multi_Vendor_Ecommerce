import { z } from "zod";
import { uuidSchema } from "@/schemas/common.schema";
import { PRODUCT_LIMITS } from "../products.constants";

/** Returns true when a canonical decimal string fits one PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart, fractionPart = ""] = unsignedValue.split(".");
  return integerPart.length <= precision - scale && fractionPart.length <= scale;
}

/** Creates one non-negative decimal contract that mirrors a PostgreSQL NUMERIC boundary. */
function nonNegativeDecimal(precision: number, scale: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/, "Enter a non-negative decimal value.")
    .refine(
      (value) => decimalFitsNumeric(value, precision, scale),
      `Value must fit NUMERIC(${precision},${scale}) without rounding.`,
    );
}

/** Product attribute input mirrors the backend's exactly-one-value representation rule. */
export const productAttributeInputSchema = z
  .object({
    attributeId: uuidSchema,
    valueText: z.string().trim().min(1).max(PRODUCT_LIMITS.DESCRIPTION_MAX_LENGTH).optional(),
    valueNumber: z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).optional(),
    valueId: uuidSchema.optional(),
  })
  .superRefine((value, context) => {
    const supplied = [value.valueText, value.valueNumber, value.valueId].filter(
      (entry) => entry !== undefined,
    );
    if (supplied.length !== 1) {
      context.addIssue({ code: "custom", message: "Choose exactly one value for each attribute." });
    }
  });

/** Validates the seller Product basics form before it reaches the API. */
export const productEditorFormSchema = z.object({
  storeId: uuidSchema,
  categoryId: uuidSchema,
  brandId: z.union([uuidSchema, z.literal("")]),
  slug: z.string().trim().toLowerCase().min(1).max(PRODUCT_LIMITS.SLUG_MAX_LENGTH),
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.NAME_MAX_LENGTH),
  description: z.string().trim().min(1).max(PRODUCT_LIMITS.DESCRIPTION_MAX_LENGTH),
  attributes: z.array(productAttributeInputSchema),
});

/** Validates one Product variant editor while keeping inventory fields out of Product Management. */
export const productVariantFormSchema = z.object({
  sku: z.string().trim().min(1).max(PRODUCT_LIMITS.SKU_MAX_LENGTH),
  title: z.string().trim().min(1).max(PRODUCT_LIMITS.VARIANT_TITLE_MAX_LENGTH),
  price: nonNegativeDecimal(18, 2),
  compareAtPrice: z.union([nonNegativeDecimal(18, 2), z.literal("")]),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  status: z.enum(["active", "inactive"]),
  weight: z.union([nonNegativeDecimal(12, 3), z.literal("")]),
  attributes: z.array(productAttributeInputSchema),
});

/** Validates Product media metadata before the signed upload workflow begins. */
export const productMediaFormSchema = z.object({
  file: z.custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "Choose an image file.",
  ),
  variantId: z.string(),
  altText: z.string().trim().max(PRODUCT_LIMITS.ALT_TEXT_MAX_LENGTH),
  sortOrder: z.number().int().nonnegative(),
});
