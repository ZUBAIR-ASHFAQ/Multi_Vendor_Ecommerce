/** Module 4 permissions returned through the server-derived authentication context. */
export const SELLER_PERMISSION = {
  PROFILE_READ: "seller.profile.read",
  PROFILE_MANAGE: "seller.profile.manage",
  STORE_MANAGE: "seller.store.manage",
  STAFF_MANAGE: "seller.staff.manage",
  ADMIN_REVIEW: "admin.sellers.review",
  ADMIN_SUSPEND: "admin.sellers.suspend",
} as const;

/** Seller application states returned by the backend. */
export const SELLER_APPLICATION_STATUS = {
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

/** Allow-listed ordering accepted by the seller-application review queue. */
export const SELLER_APPLICATION_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
} as const;

export type SellerApplicationSort =
  (typeof SELLER_APPLICATION_SORT)[keyof typeof SELLER_APPLICATION_SORT];

/** Human-readable sort choices for the seller-application administration queue. */
export const SELLER_APPLICATION_SORT_OPTIONS: Array<{
  value: SellerApplicationSort;
  label: string;
}> = [
  { value: SELLER_APPLICATION_SORT.CREATED_DESC, label: "Newest first" },
  { value: SELLER_APPLICATION_SORT.CREATED_ASC, label: "Oldest first" },
];

/** Frontend limits mirror the database-aligned Module 4 HTTP contracts. */
export const SELLER_LIMITS = {
  LEGAL_NAME_MAX_LENGTH: 220,
  DISPLAY_NAME_MAX_LENGTH: 200,
  TAX_ID_MAX_LENGTH: 120,
  STORE_SLUG_MAX_LENGTH: 160,
  STORE_NAME_MAX_LENGTH: 200,
  SUPPORT_EMAIL_MAX_LENGTH: 320,
} as const;

/** Returns true when the server-derived permission list contains one Module 4 permission. */
export function hasSellerPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
