import { z } from "zod";
import { SELLER_LIMITS } from "../sellers.constants";

const storeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const currencyPattern = /^[A-Z]{3}$/;

/** Validates the minimum business profile required by seller onboarding. */
export const sellerApplicationFormSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, "Legal name is required")
    .max(SELLER_LIMITS.LEGAL_NAME_MAX_LENGTH),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(SELLER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
  taxId: z.string().trim().max(SELLER_LIMITS.TAX_ID_MAX_LENGTH),
});

/** Validates editable seller-profile values without exposing ownership or lifecycle status. */
export const sellerProfileFormSchema = sellerApplicationFormSchema;

/** Validates the shared store setup fields used by create and edit forms. */
export const sellerStoreFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Store slug is required")
    .max(SELLER_LIMITS.STORE_SLUG_MAX_LENGTH)
    .regex(storeSlugPattern, "Use lowercase letters, numbers, and single hyphens"),
  name: z
    .string()
    .trim()
    .min(1, "Store name is required")
    .max(SELLER_LIMITS.STORE_NAME_MAX_LENGTH),
  description: z.string().trim(),
  logoFileId: z.union([z.literal(""), z.uuid()]),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Use a three-letter currency code")
    .regex(currencyPattern, "Use a three-letter currency code"),
  supportEmail: z.union([
    z.literal(""),
    z.string().trim().max(SELLER_LIMITS.SUPPORT_EMAIL_MAX_LENGTH).email("Invalid support email"),
  ]),
});

/** Adds the seller-controlled active/inactive lifecycle value used only by store editing. */
export const sellerStoreEditorFormSchema = sellerStoreFormSchema.extend({
  status: z.enum(["active", "inactive"]),
});

/** Validates the exact-email lookup used by a seller owner to find one staff candidate. */
export const sellerStaffLookupFormSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

/** Requires one server-returned role identifier before seller staff access is assigned. */
export const sellerStaffAssignmentFormSchema = z.object({
  roleId: z.uuid("Select a valid seller role."),
});

/** Validates the mandatory reason collected by the seller-application rejection flow. */
export const rejectSellerApplicationFormSchema = z.object({
  reason: z.string().trim().min(1, "Rejection reason is required"),
});

/** Validates the seller identifier and optional reason for the explicit admin suspension action. */
export const suspendSellerFormSchema = z.object({
  sellerId: z.uuid("Enter a valid seller UUID."),
  reason: z.string().trim(),
});

