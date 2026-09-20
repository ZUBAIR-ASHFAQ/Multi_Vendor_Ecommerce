import { z } from "zod";
import { isoDateTimeSchema, pageSchema, pageSizeSchema, uuidSchema } from "@/schemas/common.schema";
import {
  COUPON_STATUS,
  PROMOTION_LIMITS,
  PROMOTION_RULE_TYPE,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "../promotions.constants";

const positiveDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/, "Enter a positive decimal with at most four decimal places.")
  .refine((value) => Number(value) > 0, "Promotion value must be greater than zero.");

/** Validates the one executable percentage rule currently supported by the service. */
export const promotionPercentageSchema = positiveDecimalSchema.refine(
  (value) => Number(value) <= 100,
  "Percentage promotion value must not exceed 100.",
);

/** Validates one promotion eligibility target. */
export const promotionScopeSchema = z.object({
  scopeType: z.enum([
    PROMOTION_SCOPE_TYPE.SELLER,
    PROMOTION_SCOPE_TYPE.STORE,
    PROMOTION_SCOPE_TYPE.CATEGORY,
    PROMOTION_SCOPE_TYPE.PRODUCT,
  ]),
  scopeId: uuidSchema,
});

/** Rejects duplicate eligibility targets in one promotion. */
export const promotionScopesSchema = z
  .array(promotionScopeSchema)
  .min(1, "Add at least one eligibility scope.")
  .max(PROMOTION_LIMITS.MAX_SCOPES_PER_PROMOTION)
  .refine((scopes) => {
    const keys = scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`);
    return new Set(keys).size === keys.length;
  }, "Promotion scopes must be unique.");

const optionalPositiveIntegerTextSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d+$/.test(value),
    "Enter a whole number or leave blank.",
  )
  .refine(
    (value) =>
      value === "" ||
      (Number(value) >= 1 && Number(value) <= PROMOTION_LIMITS.MAX_COUPON_USES),
    "Coupon usage limit is outside the supported range.",
  );

/** Editable coupon values owned by the promotion form. */
export const promotionCouponFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Coupon code is required.")
    .max(PROMOTION_LIMITS.COUPON_CODE_MAX_LENGTH)
    .transform((value) => value.toUpperCase()),
  maxUses: optionalPositiveIntegerTextSchema,
  maxUsesPerCustomer: optionalPositiveIntegerTextSchema,
  status: z.enum([COUPON_STATUS.ACTIVE, COUPON_STATUS.INACTIVE]),
});

/** Frontend promotion editor values before local datetime inputs are converted to ISO timestamps. */
export const promotionFormSchema = z
  .object({
    name: z.string().trim().min(1, "Promotion name is required.").max(PROMOTION_LIMITS.NAME_MAX_LENGTH),
    type: z.literal(PROMOTION_RULE_TYPE.PERCENTAGE),
    value: promotionPercentageSchema,
    startAt: z.string().min(1, "Start date and time are required."),
    endAt: z.string().min(1, "End date and time are required."),
    scopes: promotionScopesSchema,
    coupon: promotionCouponFormSchema.nullable(),
  })
  .superRefine((value, context) => {
    const start = Date.parse(value.startAt);
    const end = Date.parse(value.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (start >= end) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Promotion end time must be later than the start time.",
      });
    }
  });

/** API create payload kept separate from form-only local datetime/coupon fields. */
export const createPromotionInputSchema = z.object({
  name: z.string().trim().min(1),
  type: z.literal(PROMOTION_RULE_TYPE.PERCENTAGE),
  value: promotionPercentageSchema,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  scopes: promotionScopesSchema,
  coupon: z
    .object({
      code: z.string().trim().min(1).transform((value) => value.toUpperCase()),
      maxUses: z.number().int().positive().optional(),
      maxUsesPerCustomer: z.number().int().positive().optional(),
    })
    .optional(),
});

/** API update payload for the documented PATCH operation. */
export const updatePromotionInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    type: z.literal(PROMOTION_RULE_TYPE.PERCENTAGE).optional(),
    value: promotionPercentageSchema.optional(),
    startAt: isoDateTimeSchema.optional(),
    endAt: isoDateTimeSchema.optional(),
    scopes: promotionScopesSchema.optional(),
    coupon: z
      .object({
        code: z.string().trim().min(1).transform((value) => value.toUpperCase()).optional(),
        maxUses: z.number().int().positive().nullable().optional(),
        maxUsesPerCustomer: z.number().int().positive().nullable().optional(),
        status: z.enum([COUPON_STATUS.ACTIVE, COUPON_STATUS.INACTIVE]).optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one editable promotion field is required.");

/** Bounded page query for the platform promotion list. */
export const adminPromotionListParamsSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
});

/** Bounded seller promotion list query with an optional server-owned lifecycle filter. */
export const sellerPromotionListParamsSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  status: z.enum([
    PROMOTION_STATUS.DRAFT,
    PROMOTION_STATUS.SCHEDULED,
    PROMOTION_STATUS.ACTIVE,
    PROMOTION_STATUS.INACTIVE,
  ]).optional(),
});

/** Private promotion representation returned by management APIs. */
export const promotionSchema = z.object({
  id: uuidSchema,
  ownerType: z.enum(["platform", "seller"]),
  sellerId: uuidSchema.nullable(),
  name: z.string(),
  type: z.string(),
  value: z.string(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  status: z.enum([
    PROMOTION_STATUS.DRAFT,
    PROMOTION_STATUS.SCHEDULED,
    PROMOTION_STATUS.ACTIVE,
    PROMOTION_STATUS.INACTIVE,
  ]),
  fundingType: z.enum(["platform", "seller"]),
  scopes: z.array(promotionScopeSchema),
  coupon: z
    .object({
      id: uuidSchema,
      promotionId: uuidSchema,
      code: z.string(),
      maxUses: z.number().int().positive().nullable(),
      maxUsesPerCustomer: z.number().int().positive().nullable(),
      status: z.enum([COUPON_STATUS.ACTIVE, COUPON_STATUS.INACTIVE]),
    })
    .nullable(),
});

/** Customer-safe discount allocation preview returned by coupon validation. */
export const promotionValidationSchema = z.object({
  valid: z.literal(true),
  promotionId: uuidSchema,
  couponId: uuidSchema,
  code: z.string(),
  fundingType: z.enum(["platform", "seller"]),
  currency: z.string().length(3),
  discountTotal: z.string(),
  allocations: z.array(
    z.object({
      cartItemId: uuidSchema,
      productId: uuidSchema,
      variantId: uuidSchema,
      discountAmount: z.string(),
    }),
  ),
});

export type PromotionScope = z.infer<typeof promotionScopeSchema>;
export type PromotionCouponForm = z.infer<typeof promotionCouponFormSchema>;
export type PromotionFormValues = z.infer<typeof promotionFormSchema>;
export type CreatePromotionInput = z.infer<typeof createPromotionInputSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionInputSchema>;
export type AdminPromotionListParams = z.infer<typeof adminPromotionListParamsSchema>;
export type SellerPromotionListParams = z.infer<typeof sellerPromotionListParamsSchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type PromotionValidation = z.infer<typeof promotionValidationSchema>;
