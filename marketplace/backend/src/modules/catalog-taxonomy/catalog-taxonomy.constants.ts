/** Shared active/inactive lifecycle values persisted by Module 5 taxonomy tables. */
export const CATALOG_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const CATALOG_STATUS_VALUES = [
  CATALOG_STATUS.ACTIVE,
  CATALOG_STATUS.INACTIVE,
] as const;

/** Concrete value-backed data type used by this project for product variant axes. */
export const CATALOG_VARIANT_AXIS_DATA_TYPE = "option" as const;

/** Stable Module 5 permissions required by the controlling marketplace guide. */
export const CATALOG_PERMISSION = {
  READ: "catalog.read",
  MANAGE_CATEGORIES: "catalog.manage_categories",
  MANAGE_BRANDS: "catalog.manage_brands",
  MANAGE_ATTRIBUTES: "catalog.manage_attributes",
} as const;

/** Module 5-owned permission catalog composed into platform RBAC by the application seed. */
export const CATALOG_PERMISSION_CATALOG = [
  {
    code: CATALOG_PERMISSION.READ,
    domain: "catalog",
    description: "Read allowed marketplace taxonomy used by catalog and seller product workflows.",
  },
  {
    code: CATALOG_PERMISSION.MANAGE_CATEGORIES,
    domain: "catalog",
    description: "Create and update category hierarchy, status, ordering, and category attribute mappings.",
  },
  {
    code: CATALOG_PERMISSION.MANAGE_BRANDS,
    domain: "catalog",
    description: "Create marketplace brand definitions used by product listings.",
  },
  {
    code: CATALOG_PERMISSION.MANAGE_ATTRIBUTES,
    domain: "catalog",
    description: "Create reusable attribute definitions and their allowed value options.",
  },
] as const;

/** Stable Module 5 business error codes named by the controlling guide. */
export const CATALOG_ERROR_CODE = {
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",
  CATEGORY_CYCLE: "CATEGORY_CYCLE",
  DUPLICATE_CATALOG_CODE: "DUPLICATE_CATALOG_CODE",
  ATTRIBUTE_INVALID_FOR_CATEGORY: "ATTRIBUTE_INVALID_FOR_CATEGORY",
} as const;

/** Durable Module 5 events named by the controlling guide. */
export const CATALOG_OUTBOX_EVENT = {
  CATEGORY_CREATED: "category.created",
  CATEGORY_UPDATED: "category.updated",
  BRAND_UPDATED: "brand.updated",
  ATTRIBUTE_UPDATED: "attribute.updated",
  CATEGORY_ATTRIBUTES_CHANGED: "category.attributes_changed",
} as const;

/** Stable resource names used by Module 5 audit rows and outbox aggregates. */
export const CATALOG_RESOURCE_TYPE = {
  CATEGORY: "catalog.category",
  BRAND: "catalog.brand",
  ATTRIBUTE: "catalog.attribute",
} as const;

/** Concise audit action names for meaningful Module 5 taxonomy changes. */
export const CATALOG_AUDIT_ACTION = {
  CATEGORY_CREATED: "catalog.category_created",
  CATEGORY_UPDATED: "catalog.category_updated",
  BRAND_CREATED: "catalog.brand_created",
  ATTRIBUTE_CREATED: "catalog.attribute_created",
  CATEGORY_ATTRIBUTES_REPLACED: "catalog.category_attributes_replaced",
} as const;

/** Database-aligned text limits used by Module 5 request and response contracts. */
export const CATALOG_LIMITS = {
  CATEGORY_SLUG_MAX_LENGTH: 160,
  CATEGORY_NAME_MAX_LENGTH: 200,
  BRAND_SLUG_MAX_LENGTH: 160,
  BRAND_NAME_MAX_LENGTH: 200,
  ATTRIBUTE_CODE_MAX_LENGTH: 120,
  ATTRIBUTE_NAME_MAX_LENGTH: 200,
  ATTRIBUTE_DATA_TYPE_MAX_LENGTH: 40,
  ATTRIBUTE_VALUE_MAX_LENGTH: 240,
} as const;
