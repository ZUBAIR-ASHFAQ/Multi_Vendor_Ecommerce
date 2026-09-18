/** Customer-profile lifecycle values persisted by Module 3. */
export const CUSTOMER_PROFILE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const CUSTOMER_PROFILE_STATUS_VALUES = [
  CUSTOMER_PROFILE_STATUS.ACTIVE,
  CUSTOMER_PROFILE_STATUS.INACTIVE,
] as const;


/** Saved-address lifecycle values persisted by Module 3. */
export const CUSTOMER_ADDRESS_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;

export const CUSTOMER_ADDRESS_STATUS_VALUES = [
  CUSTOMER_ADDRESS_STATUS.ACTIVE,
  CUSTOMER_ADDRESS_STATUS.ARCHIVED,
] as const;


/** Allow-listed sort keys for privileged customer search. */
export const CUSTOMER_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
  NAME_ASC: "name_asc",
  NAME_DESC: "name_desc",
} as const;

export const CUSTOMER_SORT_VALUES = [
  CUSTOMER_SORT.CREATED_DESC,
  CUSTOMER_SORT.CREATED_ASC,
  CUSTOMER_SORT.NAME_ASC,
  CUSTOMER_SORT.NAME_DESC,
] as const;


/** Stable Module 3 permissions used by route middleware and service policy checks. */
export const CUSTOMER_PERMISSION = {
  PROFILE_READ_OWN: "customer.profile.read_own",
  PROFILE_UPDATE_OWN: "customer.profile.update_own",
  ADDRESS_MANAGE_OWN: "customer.address.manage_own",
  ADMIN_CUSTOMERS_READ: "admin.customers.read",
} as const;


/**
 * Module-owned permission catalog.
 * Platform RBAC seed composition merges this catalog with the existing Administration permissions.
 */
export const CUSTOMER_PERMISSION_CATALOG = [
  {
    code: CUSTOMER_PERMISSION.PROFILE_READ_OWN,
    domain: "customer",
    description: "Read the authenticated customer's commerce profile.",
  },
  {
    code: CUSTOMER_PERMISSION.PROFILE_UPDATE_OWN,
    domain: "customer",
    description: "Update permitted fields on the authenticated customer's commerce profile.",
  },
  {
    code: CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN,
    domain: "customer",
    description: "Create, update, list, and archive addresses owned by the authenticated customer.",
  },
  {
    code: CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ,
    domain: "admin",
    description: "Search customers and read permission-scoped customer commerce summaries.",
  },
] as const;

/** Stable Module 3 business error codes required by the controlling guide. */
export const CUSTOMER_ERROR_CODE = {
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",
  ADDRESS_NOT_FOUND: "ADDRESS_NOT_FOUND",
  ADDRESS_SCOPE_FORBIDDEN: "ADDRESS_SCOPE_FORBIDDEN",
} as const;


/** Durable customer events named by the Module 3 requirements. */
export const CUSTOMER_OUTBOX_EVENT = {
  CUSTOMER_CREATED: "customer.created",
  CUSTOMER_UPDATED: "customer.updated",
  CUSTOMER_ADDRESS_CHANGED: "customer.address_changed",
  CUSTOMER_STATUS_CHANGED: "customer.status_changed",
} as const;

/** Concise audit actions for meaningful Module 3 writes. */
export const CUSTOMER_AUDIT_ACTION = {
  PROFILE_CREATED: "customer.created",
  PROFILE_UPDATED: "customer.profile_updated",
  ADDRESS_CREATED: "customer.address_created",
  ADDRESS_UPDATED: "customer.address_updated",
  ADDRESS_ARCHIVED: "customer.address_archived",
} as const;

/** API/database-aligned limits used by Module 3 contracts. */
export const CUSTOMER_LIMITS = {
  DISPLAY_NAME_MAX_LENGTH: 200,
  PHONE_MAX_LENGTH: 32,
  ADDRESS_LABEL_MAX_LENGTH: 100,
  RECIPIENT_NAME_MAX_LENGTH: 200,
  ADDRESS_LINE_MAX_LENGTH: 255,
  CITY_MAX_LENGTH: 120,
  REGION_MAX_LENGTH: 120,
  POSTAL_CODE_MAX_LENGTH: 32,
  COUNTRY_CODE_LENGTH: 2,
  SEARCH_MAX_LENGTH: 200,
} as const;

/** Lexical patterns shared by Zod and the future HTTP/OpenAPI registration. */
export const CUSTOMER_PATTERN = {
  PHONE: "^[0-9+().\\-\\s]+$",
  COUNTRY_CODE: "^[A-Za-z]{2}$",
} as const;
