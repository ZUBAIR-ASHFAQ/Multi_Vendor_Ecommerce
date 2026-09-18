export const ADMIN_PERMISSION = {
  USERS_READ: "admin.users.read",
  USERS_STATUS_MANAGE: "admin.users.status.manage",
  USERS_ROLES_MANAGE: "admin.users.roles.manage",
  ROLES_READ: "admin.roles.read",
  ROLES_CREATE: "admin.roles.create",
  ROLES_PERMISSIONS_MANAGE: "admin.roles.permissions.manage",
  SETTINGS_MANAGE: "admin.settings.manage",
  SELLER_STAFF_MANAGE: "seller.staff.manage",
} as const;

export const PLATFORM_SETTING_KEY = {
  SUPPORTED_CURRENCIES: "commerce.supported_currencies",
  DEFAULT_CURRENCY: "commerce.default_currency",
  DEFAULT_TAX_RATE_PERCENT: "commerce.default_tax_rate_percent",
} as const;

/** Returns true when the current server-provided permission list contains a code. */
export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
