import { z } from "zod";
import {
  CUSTOMER_LIMITS,
  CUSTOMER_PROFILE_STATUS,
  CUSTOMER_SORT,
} from "../customers.constants";

const phonePattern = /^[0-9+().\-\s]+$/;
const countryCodePattern = /^[A-Za-z]{2}$/;

/** Validates the editable customer-profile form without exposing status or ownership. */
export const customerProfileFormSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required").max(CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH),
  phone: z
    .string()
    .trim()
    .max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH)
    .refine((value) => value === "" || value.length >= 3, "Phone is too short")
    .refine((value) => value === "" || phonePattern.test(value), "Invalid phone format"),
  marketingOptIn: z.boolean(),
});

/** Validates saved-address form values before the backend performs ownership and default-address rules. */
export const customerAddressFormSchema = z.object({
  label: z.string().trim().min(1, "Address label is required").max(CUSTOMER_LIMITS.ADDRESS_LABEL_MAX_LENGTH),
  recipientName: z.string().trim().min(1, "Recipient name is required").max(CUSTOMER_LIMITS.RECIPIENT_NAME_MAX_LENGTH),
  phone: z
    .string()
    .trim()
    .min(3, "Phone is too short")
    .max(CUSTOMER_LIMITS.PHONE_MAX_LENGTH)
    .regex(phonePattern, "Invalid phone format"),
  line1: z.string().trim().min(1, "Address line 1 is required").max(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH),
  line2: z.string().trim().max(CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH),
  city: z.string().trim().min(1, "City is required").max(CUSTOMER_LIMITS.CITY_MAX_LENGTH),
  region: z.string().trim().min(1, "Region is required").max(CUSTOMER_LIMITS.REGION_MAX_LENGTH),
  postalCode: z.string().trim().max(CUSTOMER_LIMITS.POSTAL_CODE_MAX_LENGTH),
  countryCode: z
    .string()
    .trim()
    .length(2, "Use a two-letter country code")
    .regex(countryCodePattern, "Use a two-letter country code"),
  isDefaultShipping: z.boolean(),
  isDefaultBilling: z.boolean(),
});

/** Validates admin customer filters before they are copied into URL query parameters. */
export const adminCustomerFilterFormSchema = z.object({
  search: z.string().trim().max(CUSTOMER_LIMITS.SEARCH_MAX_LENGTH),
  profileStatus: z.union([
    z.literal(""),
    z.literal(CUSTOMER_PROFILE_STATUS.ACTIVE),
    z.literal(CUSTOMER_PROFILE_STATUS.INACTIVE),
  ]),
  accountStatus: z.union([
    z.literal(""),
    z.literal("active"),
    z.literal("inactive"),
    z.literal("locked"),
    z.literal("pending"),
  ]),
  sort: z.union([
    z.literal(CUSTOMER_SORT.CREATED_DESC),
    z.literal(CUSTOMER_SORT.CREATED_ASC),
    z.literal(CUSTOMER_SORT.NAME_ASC),
    z.literal(CUSTOMER_SORT.NAME_DESC),
  ]),
});

export type CustomerAddressFormValues = z.infer<typeof customerAddressFormSchema>;
export type AdminCustomerFilterFormValues = z.infer<typeof adminCustomerFilterFormSchema>;
