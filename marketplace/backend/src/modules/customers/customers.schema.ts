import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import { USER_STATUS_VALUES } from "../administration/administration.constants.js";
import {
  CUSTOMER_ADDRESS_STATUS_VALUES,
  CUSTOMER_LIMITS,
  CUSTOMER_PATTERN,
  CUSTOMER_PROFILE_STATUS_VALUES,
  CUSTOMER_SORT,
  CUSTOMER_SORT_VALUES,
} from "./customers.constants.js";

/** Creates a trimmed, non-blank text contract with one explicit maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Normalizes a required region value without assuming one country's region-code format. */
function normalizeRegion(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Normalizes a two-letter country code to its persisted uppercase form. */
function normalizeCountryCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Shared phone boundary: simple, readable and intentionally provider-neutral. */
export const customerPhoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH)
  .regex(new RegExp(CUSTOMER_PATTERN.PHONE), "Invalid phone format");

/** Customer profile status remains server-controlled but is exposed in response contracts. */
export const customerProfileStatusSchema = z.enum(
  CUSTOMER_PROFILE_STATUS_VALUES,
);

/** Saved-address status remains server-controlled but is exposed in response contracts. */
export const customerAddressStatusSchema = z.enum(
  CUSTOMER_ADDRESS_STATUS_VALUES,
);

/** Two-letter country code normalized at the API boundary. */
export const customerCountryCodeSchema = z
  .string()
  .trim()
  .length(CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH)
  .regex(new RegExp(CUSTOMER_PATTERN.COUNTRY_CODE), "Invalid country code")
  .transform(normalizeCountryCode);

/** Region is normalized for whitespace while preserving human-readable region names/codes. */
export const customerRegionSchema = nonBlankString(
  CUSTOMER_LIMITS.REGION_MAX_LENGTH,
).transform(normalizeRegion);

/** URL params for one saved customer address. */
export const customerAddressIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** URL params for privileged customer detail reads. */
export const adminCustomerIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Editable self-service profile fields. Ownership and status are never client-controlled. */
export const updateCustomerProfileBodySchema = z
  .object({
    displayName: nonBlankString(CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH).optional(),
    phone: customerPhoneSchema.nullable().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable customer profile field is required",
  });

const customerAddressCreateShape = {
  label: nonBlankString(CUSTOMER_LIMITS.ADDRESS_LABEL_MAX_LENGTH),
  recipientName: nonBlankString(CUSTOMER_LIMITS.RECIPIENT_NAME_MAX_LENGTH),
  phone: customerPhoneSchema,
  line1: nonBlankString(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH),
  line2: nonBlankString(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH)
    .nullable()
    .optional(),
  city: nonBlankString(CUSTOMER_LIMITS.CITY_MAX_LENGTH),
  region: customerRegionSchema,
  postalCode: nonBlankString(CUSTOMER_LIMITS.POSTAL_CODE_MAX_LENGTH)
    .nullable()
    .optional(),
  countryCode: customerCountryCodeSchema,
  isDefaultShipping: z.boolean().default(false),
  isDefaultBilling: z.boolean().default(false),
} as const;

/** Creates one saved address for the authenticated customer. */
export const createCustomerAddressBodySchema = z
  .object(customerAddressCreateShape)
  .strict();

/** Updates only editable fields on one address owned by the authenticated customer. */
export const updateCustomerAddressBodySchema = z
  .object({
    label: customerAddressCreateShape.label.optional(),
    recipientName: customerAddressCreateShape.recipientName.optional(),
    phone: customerAddressCreateShape.phone.optional(),
    line1: customerAddressCreateShape.line1.optional(),
    line2: customerAddressCreateShape.line2,
    city: customerAddressCreateShape.city.optional(),
    region: customerAddressCreateShape.region.optional(),
    postalCode: customerAddressCreateShape.postalCode,
    countryCode: customerAddressCreateShape.countryCode.optional(),
    isDefaultShipping: z.boolean().optional(),
    isDefaultBilling: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable address field is required",
  });

/** Bounded, allow-listed privileged customer search contract. */
export const adminCustomerListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(CUSTOMER_LIMITS.SEARCH_MAX_LENGTH).optional(),
  profileStatus: customerProfileStatusSchema.optional(),
  accountStatus: z.enum(USER_STATUS_VALUES).optional(),
  sort: z.enum(CUSTOMER_SORT_VALUES).default(CUSTOMER_SORT.CREATED_DESC),
});

/** Public response shape for the authenticated customer's commerce profile. */
export const customerProfileResponseSchema = z
  .object({
    userId: uuidSchema,
    displayName: z.string().min(1).max(CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
    phone: z.string().max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH).nullable(),
    status: customerProfileStatusSchema,
    marketingOptIn: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Public response shape for one saved customer address. */
export const customerAddressResponseSchema = z
  .object({
    id: uuidSchema,
    customerUserId: uuidSchema,
    label: z.string().min(1).max(CUSTOMER_LIMITS.ADDRESS_LABEL_MAX_LENGTH),
    recipientName: z.string().min(1).max(CUSTOMER_LIMITS.RECIPIENT_NAME_MAX_LENGTH),
    phone: z.string().min(1).max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH),
    line1: z.string().min(1).max(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH),
    line2: z.string().max(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH).nullable(),
    city: z.string().min(1).max(CUSTOMER_LIMITS.CITY_MAX_LENGTH),
    region: z.string().min(1).max(CUSTOMER_LIMITS.REGION_MAX_LENGTH),
    postalCode: z.string().max(CUSTOMER_LIMITS.POSTAL_CODE_MAX_LENGTH).nullable(),
    countryCode: z
      .string()
      .length(CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH)
      .regex(/^[A-Z]{2}$/),
    isDefaultShipping: z.boolean(),
    isDefaultBilling: z.boolean(),
    status: customerAddressStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Privileged customer list row composed only from Module 2 + Module 3 owned data. */
export const adminCustomerListItemSchema = z
  .object({
    userId: uuidSchema,
    email: z.string().email(),
    accountStatus: z.enum(USER_STATUS_VALUES),
    profileStatus: customerProfileStatusSchema,
    displayName: z.string().min(1).max(CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
    phone: z.string().max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH).nullable(),
    marketingOptIn: z.boolean(),
    addressCount: z.number().int().min(0),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/**
 * Privileged customer detail available before Orders exists.
 * Later commerce modules may extend this response without inventing order data in Module 3.
 */
export const adminCustomerDetailSchema = z
  .object({
    customer: adminCustomerListItemSchema,
    addresses: z.array(customerAddressResponseSchema),
  })
  .strict();

/** Inferred request/response types stay beside their Zod source of truth. */
export type UpdateCustomerProfileInput = z.infer<
  typeof updateCustomerProfileBodySchema
>;
export type CreateCustomerAddressInput = z.infer<
  typeof createCustomerAddressBodySchema
>;
export type UpdateCustomerAddressInput = z.infer<
  typeof updateCustomerAddressBodySchema
>;
export type AdminCustomerListQuery = z.infer<typeof adminCustomerListQuerySchema>;
export type CustomerProfileResponse = z.infer<typeof customerProfileResponseSchema>;
export type CustomerAddressResponse = z.infer<typeof customerAddressResponseSchema>;
export type AdminCustomerListItem = z.infer<typeof adminCustomerListItemSchema>;
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
