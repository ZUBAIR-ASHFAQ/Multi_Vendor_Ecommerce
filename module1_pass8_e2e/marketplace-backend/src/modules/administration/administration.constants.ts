/** Account categories stored on the core user identity. */
export const ACCOUNT_TYPE = {
  PLATFORM_ADMIN: "platform_admin",
  SELLER: "seller",
  CUSTOMER: "customer",
} as const;

export const ACCOUNT_TYPE_VALUES = [
  ACCOUNT_TYPE.PLATFORM_ADMIN,
  ACCOUNT_TYPE.SELLER,
  ACCOUNT_TYPE.CUSTOMER,
] as const;

export type AccountType =
  (typeof ACCOUNT_TYPE)[keyof typeof ACCOUNT_TYPE];

/** RBAC role scope categories persisted before seller/store tables exist. */
export const ROLE_SCOPE_TYPE = {
  PLATFORM: "platform",
  SELLER: "seller",
  CUSTOMER: "customer",
} as const;

export const ROLE_SCOPE_TYPE_VALUES = [
  ROLE_SCOPE_TYPE.PLATFORM,
  ROLE_SCOPE_TYPE.SELLER,
  ROLE_SCOPE_TYPE.CUSTOMER,
] as const;

export type RoleScopeType =
  (typeof ROLE_SCOPE_TYPE)[keyof typeof ROLE_SCOPE_TYPE];

/** Platform-user lifecycle values. */
export const USER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  LOCKED: "locked",
  PENDING: "pending",
} as const;

export const USER_STATUS_VALUES = [
  USER_STATUS.ACTIVE,
  USER_STATUS.INACTIVE,
  USER_STATUS.LOCKED,
  USER_STATUS.PENDING,
] as const;

/** Role lifecycle values. */
export const ROLE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const ROLE_STATUS_VALUES = [
  ROLE_STATUS.ACTIVE,
  ROLE_STATUS.INACTIVE,
] as const;

/** Protected system-role definitions seeded by Module 2. */
export const SYSTEM_ROLE = {
  PLATFORM_SUPER_ADMIN: {
    code: "platform_super_admin",
    scopeType: ROLE_SCOPE_TYPE.PLATFORM,
    name: "Platform Super Admin",
    description:
      "Protected platform role with all seeded platform permissions.",
  },
  CUSTOMER_SELF_SERVICE: {
    code: "customer_self_service",
    scopeType: ROLE_SCOPE_TYPE.CUSTOMER,
    name: "Customer Self Service",
    description:
      "Protected customer role with the minimum permissions required for profile and address self-service.",
  },
} as const;

/** Stable Administration/RBAC permission codes. */
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

/** Server-controlled seed catalog. Keep permission descriptions here to prevent drift. */
export const ADMIN_PERMISSION_CATALOG = [
  {
    code: ADMIN_PERMISSION.USERS_READ,
    domain: "admin",
    description: "View platform users and their administrative access summary.",
  },
  {
    code: ADMIN_PERMISSION.USERS_STATUS_MANAGE,
    domain: "admin",
    description:
      "Activate, deactivate, lock, or unlock platform users through controlled commands.",
  },
  {
    code: ADMIN_PERMISSION.USERS_ROLES_MANAGE,
    domain: "admin",
    description: "Replace role assignments for a platform user.",
  },
  {
    code: ADMIN_PERMISSION.ROLES_READ,
    domain: "admin",
    description: "View roles and their permission assignments.",
  },
  {
    code: ADMIN_PERMISSION.ROLES_CREATE,
    domain: "admin",
    description: "Create non-system roles.",
  },
  {
    code: ADMIN_PERMISSION.ROLES_PERMISSIONS_MANAGE,
    domain: "admin",
    description:
      "Replace permission assignments for an authorized role.",
  },
  {
    code: ADMIN_PERMISSION.SETTINGS_MANAGE,
    domain: "admin",
    description: "Read and update allow-listed non-secret platform settings.",
  },
  {
    code: ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    domain: "seller",
    description: "Manage approved staff role assignments inside an authorized seller scope.",
  },
] as const;

/** Platform-setting keys owned by Administration in the current core scope. */
export const PLATFORM_SETTING_KEY = {
  SUPPORTED_CURRENCIES: "commerce.supported_currencies",
  DEFAULT_CURRENCY: "commerce.default_currency",
  DEFAULT_TAX_RATE_PERCENT: "commerce.default_tax_rate_percent",
  RETURNS_WINDOW_DAYS: "returns.window_days",
} as const;

export const PLATFORM_SETTING_KEYS = [
  PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
  PLATFORM_SETTING_KEY.DEFAULT_CURRENCY,
  PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT,
  PLATFORM_SETTING_KEY.RETURNS_WINDOW_DAYS,
] as const;

export const ADMIN_LIMITS = {
  DISPLAY_NAME_MAX_LENGTH: 200,
  ROLE_CODE_MAX_LENGTH: 100,
  ROLE_NAME_MAX_LENGTH: 150,
  ROLE_DESCRIPTION_MAX_LENGTH: 2000,
  SEARCH_MAX_LENGTH: 200,
  MAX_ROLE_ASSIGNMENTS_PER_USER: 100,
  MAX_PERMISSIONS_PER_ROLE: 500,
} as const;

/** Stable Administration/RBAC error codes. */
export const ADMIN_ERROR_CODE = {
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_STATUS_INVALID: "ADMIN_USER_STATUS_INVALID",
  USER_ROLE_ASSIGNMENT_INVALID: "ADMIN_USER_ROLE_ASSIGNMENT_INVALID",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  DUPLICATE_ROLE_CODE: "ADMIN_DUPLICATE_ROLE_CODE",
  SYSTEM_ROLE_PROTECTED: "ADMIN_SYSTEM_ROLE_PROTECTED",
  PERMISSION_NOT_FOUND: "ADMIN_PERMISSION_NOT_FOUND",
  ROLE_PERMISSION_ASSIGNMENT_INVALID: "ADMIN_ROLE_PERMISSION_ASSIGNMENT_INVALID",
  SELLER_SCOPE_FORBIDDEN: "SELLER_SCOPE_FORBIDDEN",
  PLATFORM_SETTING_INVALID: "INVALID_PLATFORM_SETTING",
} as const;

/** Audit events emitted by Administration service writes. */
export const ADMIN_AUDIT_EVENT = {
  USER_CREATED: "admin.user_created",
  USER_STATUS_CHANGED: "admin.user_status_changed",
  USER_ROLES_CHANGED: "admin.user_roles_changed",
  ROLE_CREATED: "admin.role_created",
  ROLE_PERMISSIONS_CHANGED: "admin.role_permissions_changed",
  PLATFORM_SETTINGS_UPDATED: "admin.platform_settings_updated",
} as const;
/** Domain events safe for async integrations. Payloads contain identifiers/state only, never credentials. */
export const ADMIN_OUTBOX_EVENT = {
  USER_CREATED: "user.created",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_ROLES_CHANGED: "user.roles_changed",
  ROLE_CREATED: "role.created",
  ROLE_UPDATED: "role.updated",
  ROLE_PERMISSIONS_CHANGED: "role.permissions_changed",
} as const;

