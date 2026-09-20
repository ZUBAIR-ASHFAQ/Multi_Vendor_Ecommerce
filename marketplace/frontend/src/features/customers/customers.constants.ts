/** Module 3 permissions used by customer pages and navigation. */
export const CUSTOMER_PERMISSION = {
  PROFILE_READ_OWN: "customer.profile.read_own",
  PROFILE_UPDATE_OWN: "customer.profile.update_own",
  ADDRESS_MANAGE_OWN: "customer.address.manage_own",
  ADMIN_CUSTOMERS_READ: "admin.customers.read",
} as const;

/** Customer profile states returned by the backend. */
export const CUSTOMER_PROFILE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

/** Allow-listed sort values accepted by the admin customer API. */
export const CUSTOMER_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
  NAME_ASC: "name_asc",
  NAME_DESC: "name_desc",
} as const;

export type CustomerSort = (typeof CUSTOMER_SORT)[keyof typeof CUSTOMER_SORT];

/** Human-readable options for the customer administration sort field. */
export const CUSTOMER_SORT_OPTIONS: Array<{ value: CustomerSort; label: string }> = [
  { value: CUSTOMER_SORT.CREATED_DESC, label: "Newest first" },
  { value: CUSTOMER_SORT.CREATED_ASC, label: "Oldest first" },
  { value: CUSTOMER_SORT.NAME_ASC, label: "Name A–Z" },
  { value: CUSTOMER_SORT.NAME_DESC, label: "Name Z–A" },
];

/** Frontend limits mirror the documented Module 3 API boundaries. */
export const CUSTOMER_LIMITS = {
  DISPLAY_NAME_MAX_LENGTH: 200,
  PHONE_MAX_LENGTH: 32,
  ADDRESS_LABEL_MAX_LENGTH: 100,
  RECIPIENT_NAME_MAX_LENGTH: 200,
  ADDRESS_LINE_MAX_LENGTH: 255,
  CITY_MAX_LENGTH: 120,
  REGION_MAX_LENGTH: 120,
  POSTAL_CODE_MAX_LENGTH: 32,
  SEARCH_MAX_LENGTH: 200,
} as const;

/** Returns true when the server-provided actor permissions contain one Module 3 permission. */
export function hasCustomerPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
