/** Module 16 permissions used only for frontend convenience; the API remains authoritative. */
export const COMMISSIONS_PERMISSION = {
  ADMIN_MANAGE: "admin.commissions.manage",
  ADMIN_READ: "admin.commissions.read",
  SELLER_READ: "seller.commissions.read",
} as const;

/** Commission rule scopes supported by the backend contract. */
export const COMMISSION_RULE_SCOPE = {
  DEFAULT: "default",
  SELLER: "seller",
  CATEGORY: "category",
  PRODUCT: "product",
} as const;

/** Immutable Commission ledger entry kinds shown by seller and finance views. */
export const COMMISSION_ENTRY_TYPE = {
  SALE: "sale",
  REFUND: "refund",
  ADJUSTMENT: "adjustment",
} as const;

/** Rule lifecycle states approved by Requirements Patch 0007. */
export const COMMISSION_RULE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

/** Stable status values reused by Zod schemas and select controls. */
export const COMMISSION_RULE_STATUS_VALUES = [
  COMMISSION_RULE_STATUS.ACTIVE,
  COMMISSION_RULE_STATUS.INACTIVE,
] as const;

/** Returns true when the authenticated actor has one Commission permission. */
export function hasCommissionPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
