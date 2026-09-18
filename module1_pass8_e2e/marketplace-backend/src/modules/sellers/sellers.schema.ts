import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  SELLER_APPLICATION_SORT,
  SELLER_APPLICATION_SORT_VALUES,
  SELLER_APPLICATION_STATUS_VALUES,
  SELLER_APPROVAL_STATUS_VALUES,
  SELLER_EDITABLE_STORE_STATUS_VALUES,
  SELLER_LIMITS,
  SELLER_PATTERN,
  SELLER_STATUS_VALUES,
  STORE_STATUS_VALUES,
} from "./sellers.constants.js";

/** Creates a trimmed non-blank string contract with one database-aligned maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Normalizes optional nullable text while preserving an explicit null value. */
function optionalNullableText(maxLength?: number) {
  const base = z.string().trim().min(1);
  const bounded = maxLength === undefined ? base : base.max(maxLength);
  return bounded.nullable().optional();
}

/** Seller application state returned by review and administration APIs. */
export const sellerApplicationStatusSchema = z.enum(
  SELLER_APPLICATION_STATUS_VALUES,
);

/** Approved seller lifecycle state returned by seller APIs. */
export const sellerStatusSchema = z.enum(SELLER_STATUS_VALUES);

/** Seller approval state is server-controlled and currently has one persisted value. */
export const sellerApprovalStatusSchema = z.enum(
  SELLER_APPROVAL_STATUS_VALUES,
);

/** Store lifecycle state returned by seller and public store APIs. */
export const storeStatusSchema = z.enum(STORE_STATUS_VALUES);

/** Store lifecycle values a seller may set through the normal store update route. */
export const sellerEditableStoreStatusSchema = z.enum(
  SELLER_EDITABLE_STORE_STATUS_VALUES,
);

/** Normalized public store slug used by create/update/path contracts. */
export const storeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(SELLER_LIMITS.STORE_SLUG_MAX_LENGTH)
  .regex(new RegExp(SELLER_PATTERN.STORE_SLUG), "Invalid store slug");

/** Normalized three-letter currency code; supported-currency membership remains a service rule. */
export const storeCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .regex(new RegExp(SELLER_PATTERN.CURRENCY), "Invalid currency code");

/** Normalized optional support email used by store write contracts. */
export const storeSupportEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(SELLER_LIMITS.SUPPORT_EMAIL_MAX_LENGTH)
  .email();

/** Minimal business profile collected by the seller application and used to create the seller master on approval. */
export const sellerApplicationBusinessProfileSchema = z
  .object({
    legalName: nonBlankString(SELLER_LIMITS.LEGAL_NAME_MAX_LENGTH),
    displayName: nonBlankString(SELLER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
    taxId: optionalNullableText(SELLER_LIMITS.TAX_ID_MAX_LENGTH),
  })
  .strict();

/** Request body for POST /api/v1/sellers/applications. Actor identity is always server-derived. */
export const submitSellerApplicationBodySchema = sellerApplicationBusinessProfileSchema;

/** Path parameter for one seller application review command. */
export const sellerApplicationIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Bounded review queue filters accepted by GET /api/v1/admin/seller-applications. */
export const adminSellerApplicationListQuerySchema = paginationQuerySchema
  .extend({
    status: sellerApplicationStatusSchema.optional(),
    sort: z
      .enum(SELLER_APPLICATION_SORT_VALUES)
      .default(SELLER_APPLICATION_SORT.CREATED_DESC),
  })
  .strict();

/** Approval has no client-owned business fields; the submitted application is authoritative. */
export const approveSellerApplicationBodySchema = z.object({}).strict();

/** Rejection requires a non-blank reason that is stored with the historical review decision. */
export const rejectSellerApplicationBodySchema = z
  .object({
    reason: z.string().trim().min(1),
  })
  .strict();

/** Editable seller-master fields. Ownership, approval and lifecycle status are server-controlled. */
export const updateSellerProfileBodySchema = z
  .object({
    legalName: nonBlankString(SELLER_LIMITS.LEGAL_NAME_MAX_LENGTH).optional(),
    displayName: nonBlankString(SELLER_LIMITS.DISPLAY_NAME_MAX_LENGTH).optional(),
    taxId: optionalNullableText(SELLER_LIMITS.TAX_ID_MAX_LENGTH),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable seller profile field is required",
  })
  .meta({ minProperties: 1 });

const storeWriteShape = {
  slug: storeSlugSchema,
  name: nonBlankString(SELLER_LIMITS.STORE_NAME_MAX_LENGTH),
  description: optionalNullableText(),
  logoFileId: uuidSchema.nullable().optional(),
  defaultCurrency: storeCurrencySchema,
  supportEmail: storeSupportEmailSchema.nullable().optional(),
} as const;

/** Request body for creating one store inside the authenticated seller scope. */
export const createStoreBodySchema = z.object(storeWriteShape).strict();

/** Path parameter for one seller-owned store update. */
export const sellerStoreIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Request body for seller-editable store fields. Suspended status remains server-controlled. */
export const updateStoreBodySchema = z
  .object({
    slug: storeWriteShape.slug.optional(),
    name: storeWriteShape.name.optional(),
    description: storeWriteShape.description,
    logoFileId: storeWriteShape.logoFileId,
    defaultCurrency: storeWriteShape.defaultCurrency.optional(),
    supportEmail: storeWriteShape.supportEmail,
    status: sellerEditableStoreStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable store field is required",
  })
  .meta({ minProperties: 1 });

/** Public store slug path normalized exactly like persisted store slugs. */
export const publicStoreSlugParamsSchema = z
  .object({
    slug: storeSlugSchema,
  })
  .strict();

/** Path parameter for the privileged seller suspension command. */
export const adminSellerIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Optional audit reason for the explicit seller suspension transition. */
export const suspendSellerBodySchema = z
  .object({
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

/** Safe seller application representation used by the applicant/admin workflows. */
export const sellerApplicationResponseSchema = z
  .object({
    id: uuidSchema,
    applicantUserId: uuidSchema,
    businessProfile: sellerApplicationBusinessProfileSchema,
    status: sellerApplicationStatusSchema,
    reviewedBy: uuidSchema.nullable(),
    reviewedAt: isoDateTimeSchema.nullable(),
    reason: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe private seller-master representation. */
export const sellerResponseSchema = z
  .object({
    id: uuidSchema,
    ownerUserId: uuidSchema,
    legalName: z.string().min(1).max(SELLER_LIMITS.LEGAL_NAME_MAX_LENGTH),
    displayName: z.string().min(1).max(SELLER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
    taxId: z.string().max(SELLER_LIMITS.TAX_ID_MAX_LENGTH).nullable(),
    status: sellerStatusSchema,
    approvalStatus: sellerApprovalStatusSchema,
    approvedAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe seller-owned store representation used by authenticated seller pages. */
export const sellerStoreResponseSchema = z
  .object({
    id: uuidSchema,
    sellerId: uuidSchema,
    slug: z.string().min(1).max(SELLER_LIMITS.STORE_SLUG_MAX_LENGTH),
    name: z.string().min(1).max(SELLER_LIMITS.STORE_NAME_MAX_LENGTH),
    description: z.string().nullable(),
    logoFileId: uuidSchema.nullable(),
    status: storeStatusSchema,
    defaultCurrency: z.string().regex(new RegExp(SELLER_PATTERN.CURRENCY)),
    supportEmail: z.string().email().max(SELLER_LIMITS.SUPPORT_EMAIL_MAX_LENGTH).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Minimal seller-staff aggregate returned by /sellers/me without exposing another user's role details. */
export const sellerStaffSummaryResponseSchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    activeCount: z.number().int().nonnegative(),
    inactiveCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) => value.activeCount + value.inactiveCount === value.totalCount,
    { message: "Seller staff summary counts must reconcile" },
  );

/** Aggregate response for GET /api/v1/sellers/me. */
export const mySellerResponseSchema = z
  .object({
    seller: sellerResponseSchema,
    stores: z.array(sellerStoreResponseSchema),
    staffSummary: sellerStaffSummaryResponseSchema,
  })
  .strict();

/** Public-safe store detail. Private legal/tax/staff fields are deliberately absent. */
export const publicStoreResponseSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().min(1).max(SELLER_LIMITS.STORE_SLUG_MAX_LENGTH),
    name: z.string().min(1).max(SELLER_LIMITS.STORE_NAME_MAX_LENGTH),
    description: z.string().nullable(),
    logoFileId: uuidSchema.nullable(),
    defaultCurrency: z.string().regex(new RegExp(SELLER_PATTERN.CURRENCY)),
    supportEmail: z.string().email().max(SELLER_LIMITS.SUPPORT_EMAIL_MAX_LENGTH).nullable(),
    seller: z
      .object({
        id: uuidSchema,
        displayName: z.string().min(1).max(SELLER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
      })
      .strict(),
  })
  .strict();

/** Approval response keeps the historical application decision beside the created seller master. */
export const approveSellerApplicationResponseSchema = z
  .object({
    application: sellerApplicationResponseSchema,
    seller: sellerResponseSchema,
  })
  .strict();

/** Inferred request and response types stay beside their Zod source of truth. */
export type SellerApplicationBusinessProfile = z.infer<
  typeof sellerApplicationBusinessProfileSchema
>;
export type SubmitSellerApplicationInput = z.infer<
  typeof submitSellerApplicationBodySchema
>;
export type AdminSellerApplicationListQuery = z.infer<
  typeof adminSellerApplicationListQuerySchema
>;
export type RejectSellerApplicationInput = z.infer<
  typeof rejectSellerApplicationBodySchema
>;
export type UpdateSellerProfileInput = z.infer<
  typeof updateSellerProfileBodySchema
>;
export type CreateStoreInput = z.infer<typeof createStoreBodySchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreBodySchema>;
export type SuspendSellerInput = z.infer<typeof suspendSellerBodySchema>;
export type SellerApplicationResponse = z.infer<
  typeof sellerApplicationResponseSchema
>;
export type SellerResponse = z.infer<typeof sellerResponseSchema>;
export type SellerStoreResponse = z.infer<typeof sellerStoreResponseSchema>;
export type SellerStaffSummaryResponse = z.infer<
  typeof sellerStaffSummaryResponseSchema
>;
export type MySellerResponse = z.infer<typeof mySellerResponseSchema>;
export type PublicStoreResponse = z.infer<typeof publicStoreResponseSchema>;
export type ApproveSellerApplicationResponse = z.infer<
  typeof approveSellerApplicationResponseSchema
>;
