/** Frontend permission names mirrored from the Module 9 backend contract. */
export const PROMOTION_PERMISSION = {
  READ: "promotions.read",
  ADMIN_MANAGE: "admin.promotions.manage",
  SELLER_MANAGE: "seller.promotions.manage",
} as const;

/** Promotion lifecycle values returned by the backend. */
export const PROMOTION_STATUS = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

/** Coupon lifecycle values returned by the backend. */
export const COUPON_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

/** Eligibility target kinds supported by the current Module 9 contract. */
export const PROMOTION_SCOPE_TYPE = {
  SELLER: "seller",
  STORE: "store",
  CATEGORY: "category",
  PRODUCT: "product",
} as const;

/** Human-readable scope choices shown by the promotion editor. */
export const PROMOTION_SCOPE_OPTIONS = [
  { value: PROMOTION_SCOPE_TYPE.SELLER, label: "Seller" },
  { value: PROMOTION_SCOPE_TYPE.STORE, label: "Store" },
  { value: PROMOTION_SCOPE_TYPE.CATEGORY, label: "Category" },
  { value: PROMOTION_SCOPE_TYPE.PRODUCT, label: "Product" },
] as const;

/** Only percentage is executable until the source contract defines other rule semantics. */
export const PROMOTION_RULE_TYPE = {
  PERCENTAGE: "percentage",
} as const;

/** Frontend limits mirror the backend request contract. */
export const PROMOTION_LIMITS = {
  NAME_MAX_LENGTH: 200,
  COUPON_CODE_MAX_LENGTH: 120,
  MAX_SCOPES_PER_PROMOTION: 100,
  MAX_COUPON_USES: 2_147_483_647,
} as const;
