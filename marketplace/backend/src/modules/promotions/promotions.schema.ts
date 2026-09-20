import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  decimalStringSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import { productCurrencySchema, productPriceSchema } from "../products/products.schema.js";
import {
  COUPON_STATUS_VALUES,
  PROMOTION_FUNDING_TYPE_VALUES,
  PROMOTION_LIMITS,
  PROMOTION_OWNER_TYPE_VALUES,
  PROMOTION_SCOPE_TYPE_VALUES,
  PROMOTION_STATUS_VALUES,
} from "./promotions.constants.js";

/** Returns true when a canonical decimal string fits one PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsignedValue.split(".");
  return integerPart.length <= precision - scale && fractionPart.length <= scale;
}

/** Returns true when one canonical non-negative decimal is greater than zero. */
function decimalIsPositive(value: string): boolean {
  const digitsOnly = value.replace(".", "");
  return /[1-9]/.test(digitsOnly) && !value.startsWith("-");
}

/** Returns true when a positive canonical decimal is at most 100 without floating-point conversion. */
function decimalAtMostOneHundred(value: string): boolean {
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  const integerValue = BigInt(integerPart);
  if (integerValue < 100n) return true;
  if (integerValue > 100n) return false;
  return !/[1-9]/.test(fractionPart);
}

/** Adds cross-field date and percentage checks shared by create/update contracts. */
function validatePromotionRule(
  value: {
    type?: string | undefined;
    value?: string | undefined;
    startAt?: string | undefined;
    endAt?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.startAt !== undefined &&
    value.endAt !== undefined &&
    Date.parse(value.startAt) >= Date.parse(value.endAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["endAt"],
      message: "Promotion endAt must be later than startAt.",
    });
  }

  if (
    value.type === "percentage" &&
    value.value !== undefined &&
    !decimalAtMostOneHundred(value.value)
  ) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "Percentage promotion value must not exceed 100.",
    });
  }
}

/** Returns true when every promotion scope appears only once in one request. */
function promotionScopesAreUnique(
  scopes: ReadonlyArray<{ scopeType: string; scopeId: string }>,
): boolean {
  const keys = scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`);
  return new Set(keys).size === keys.length;
}

/** Trimmed, lowercased promotion rule identifier; the guide does not define a closed rule-type enum. */
export const promotionTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(PROMOTION_LIMITS.TYPE_MAX_LENGTH);

/** Positive NUMERIC(18,4) promotion value transported as a decimal string. */
export const promotionValueSchema = decimalStringSchema
  .refine(decimalIsPositive, "Promotion value must be greater than zero.")
  .refine(
    (value) =>
      decimalFitsNumeric(
        value,
        PROMOTION_LIMITS.VALUE_PRECISION,
        PROMOTION_LIMITS.VALUE_SCALE,
      ),
    `Promotion value must fit NUMERIC(${PROMOTION_LIMITS.VALUE_PRECISION},${PROMOTION_LIMITS.VALUE_SCALE}) without rounding.`,
  );

/** Platform/seller ownership value returned by private promotion APIs. */
export const promotionOwnerTypeSchema = z.enum(PROMOTION_OWNER_TYPE_VALUES);

/** Server-controlled promotion lifecycle value. */
export const promotionStatusSchema = z.enum(PROMOTION_STATUS_VALUES);

/** Server-derived party funding the discount. */
export const promotionFundingTypeSchema = z.enum(PROMOTION_FUNDING_TYPE_VALUES);

/** Current coupon lifecycle value. */
export const couponStatusSchema = z.enum(COUPON_STATUS_VALUES);

/** Allow-listed persisted eligibility target kinds supported by the current Module 9 guide. */
export const promotionScopeTypeSchema = z.enum(PROMOTION_SCOPE_TYPE_VALUES);

/** Normalized customer-facing coupon code. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(PROMOTION_LIMITS.COUPON_CODE_MAX_LENGTH);

/** One target used to constrain a promotion to a Seller, Store, Category, or Product. */
export const promotionScopeInputSchema = z
  .object({
    scopeType: promotionScopeTypeSchema,
    scopeId: uuidSchema,
  })
  .strict();

/** Promotion scope collection with duplicate targets rejected before persistence. */
export const promotionScopesInputSchema = z
  .array(promotionScopeInputSchema)
  .min(1)
  .max(PROMOTION_LIMITS.MAX_SCOPES_PER_PROMOTION)
  .refine(promotionScopesAreUnique, "Promotion scopes must be unique.");

/** Coupon definition optionally attached while creating a promotion. */
export const createCouponInputSchema = z
  .object({
    code: couponCodeSchema,
    maxUses: z.number().int().min(1).max(PROMOTION_LIMITS.MAX_COUPON_USES).optional(),
    maxUsesPerCustomer: z
      .number()
      .int()
      .min(1)
      .max(PROMOTION_LIMITS.MAX_COUPON_USES)
      .optional(),
  })
  .strict();

/** Editable coupon fields exposed through the promotion PATCH route; deletion is intentionally not generic CRUD. */
export const updateCouponInputSchema = z
  .object({
    code: couponCodeSchema.optional(),
    maxUses: z.number().int().min(1).max(PROMOTION_LIMITS.MAX_COUPON_USES).nullable().optional(),
    maxUsesPerCustomer: z
      .number()
      .int()
      .min(1)
      .max(PROMOTION_LIMITS.MAX_COUPON_USES)
      .nullable()
      .optional(),
    status: couponStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable coupon field is required.",
  })
  .meta({ minProperties: 1 });

const createPromotionShape = {
  name: z.string().trim().min(1).max(PROMOTION_LIMITS.NAME_MAX_LENGTH),
  type: promotionTypeSchema,
  value: promotionValueSchema,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  scopes: promotionScopesInputSchema,
  coupon: createCouponInputSchema.optional(),
} as const;

/** Request body for POST /api/v1/admin/promotions; ownership and funding stay server-derived as platform values. */
export const createPlatformPromotionBodySchema = z
  .object(createPromotionShape)
  .strict()
  .superRefine(validatePromotionRule);

/** Request body for POST /api/v1/seller/promotions; seller ownership and funding are derived from auth scope. */
export const createSellerPromotionBodySchema = z
  .object(createPromotionShape)
  .strict()
  .superRefine(validatePromotionRule);

/** Path parameter shared by promotion update/activate/deactivate commands. */
export const promotionIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Bounded admin list query; no undocumented Module 9 filters are accepted yet. */
export const adminPromotionListQuerySchema = paginationQuerySchema.strict();

/** Seller-owned promotion list query; ownership remains derived from authenticated seller permissions. */
export const sellerPromotionListQuerySchema = paginationQuerySchema
  .extend({
    status: promotionStatusSchema.optional(),
  })
  .strict();

/** Request body for PATCH /api/v1/admin/promotions/:id; status/ownership/funding remain command/server owned. */
export const updatePromotionBodySchema = z
  .object({
    name: z.string().trim().min(1).max(PROMOTION_LIMITS.NAME_MAX_LENGTH).optional(),
    type: promotionTypeSchema.optional(),
    value: promotionValueSchema.optional(),
    startAt: isoDateTimeSchema.optional(),
    endAt: isoDateTimeSchema.optional(),
    scopes: promotionScopesInputSchema.optional(),
    coupon: updateCouponInputSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable promotion field is required.",
  })
  .superRefine(validatePromotionRule)
  .meta({ minProperties: 1 });

/** GET /api/v1/promotions/validate query; customer identity and current Cart are server-derived. */
export const validatePromotionQuerySchema = z
  .object({
    code: couponCodeSchema,
  })
  .strict();

/** Empty activation/deactivation command body that also accepts an omitted JSON body. */
export const emptyPromotionCommandBodySchema = z.object({}).strict().default({});

/** One persisted eligibility scope returned by private promotion management APIs. */
export const promotionScopeResponseSchema = promotionScopeInputSchema;

/** Safe coupon representation used by promotion management responses. */
export const couponResponseSchema = z
  .object({
    id: uuidSchema,
    promotionId: uuidSchema,
    code: couponCodeSchema,
    maxUses: z.number().int().positive().nullable(),
    maxUsesPerCustomer: z.number().int().positive().nullable(),
    status: couponStatusSchema,
  })
  .strict();

/** Safe private promotion representation used by admin/seller management workflows. */
export const promotionResponseSchema = z
  .object({
    id: uuidSchema,
    ownerType: promotionOwnerTypeSchema,
    sellerId: uuidSchema.nullable(),
    name: z.string().min(1).max(PROMOTION_LIMITS.NAME_MAX_LENGTH),
    type: promotionTypeSchema,
    value: promotionValueSchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    status: promotionStatusSchema,
    fundingType: promotionFundingTypeSchema,
    scopes: z.array(promotionScopeResponseSchema),
    coupon: couponResponseSchema.nullable(),
  })
  .strict();

/** Data array returned by the paginated admin promotion list. */
export const promotionListDataSchema = z.array(promotionResponseSchema);

/** One deterministic Cart-line discount allocation returned by coupon validation preview. */
export const promotionDiscountAllocationResponseSchema = z
  .object({
    cartItemId: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema,
    discountAmount: productPriceSchema,
  })
  .strict();

/** Customer-safe, non-authoritative coupon preview; Checkout must recalculate before order confirmation. */
export const promotionValidationResponseSchema = z
  .object({
    valid: z.literal(true),
    promotionId: uuidSchema,
    couponId: uuidSchema,
    code: couponCodeSchema,
    fundingType: promotionFundingTypeSchema,
    currency: productCurrencySchema,
    discountTotal: productPriceSchema,
    allocations: z.array(promotionDiscountAllocationResponseSchema),
  })
  .strict();

export type CreatePlatformPromotionInput = z.infer<
  typeof createPlatformPromotionBodySchema
>;
export type CreateSellerPromotionInput = z.infer<
  typeof createSellerPromotionBodySchema
>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionBodySchema>;
export type AdminPromotionListQuery = z.infer<typeof adminPromotionListQuerySchema>;
export type SellerPromotionListQuery = z.infer<typeof sellerPromotionListQuerySchema>;
export type ValidatePromotionQuery = z.infer<typeof validatePromotionQuerySchema>;
export type PromotionScopeInput = z.infer<typeof promotionScopeInputSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponInputSchema>;
export type PromotionResponse = z.infer<typeof promotionResponseSchema>;
export type PromotionValidationResponse = z.infer<
  typeof promotionValidationResponseSchema
>;
