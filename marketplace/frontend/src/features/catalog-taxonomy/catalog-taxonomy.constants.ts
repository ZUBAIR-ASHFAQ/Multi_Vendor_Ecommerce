/** Stable Module 5 permission codes used only to drive frontend navigation and convenience hiding. */
export const CATALOG_PERMISSION = {
  READ: "catalog.read",
  MANAGE_CATEGORIES: "catalog.manage_categories",
  MANAGE_BRANDS: "catalog.manage_brands",
  MANAGE_ATTRIBUTES: "catalog.manage_attributes",
} as const;

/** Database-aligned frontend limits kept in sync with the Module 5 API contract. */
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

/** Returns whether the server-derived permission set contains one Module 5 permission. */
export function hasCatalogPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
