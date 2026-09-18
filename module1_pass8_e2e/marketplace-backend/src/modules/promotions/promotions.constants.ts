/** Stable Module 9 permissions named by the controlling Promotions & Coupons contract. */
export const PROMOTION_PERMISSION = {
  READ: "promotions.read",
  ADMIN_MANAGE: "admin.promotions.manage",
  SELLER_MANAGE: "seller.promotions.manage",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const PROMOTION_PERMISSION_CATALOG = [
  {
    code: PROMOTION_PERMISSION.READ,
    domain: "promotions",
    description: "Validate and read customer-safe promotion eligibility results.",
  },
  {
    code: PROMOTION_PERMISSION.ADMIN_MANAGE,
    domain: "promotions",
    description: "Create, edit, activate, deactivate, and list platform promotions.",
  },
  {
    code: PROMOTION_PERMISSION.SELLER_MANAGE,
    domain: "promotions",
    description: "Create seller-funded promotions inside the authenticated seller scope.",
  },
] as const;

/** Stable Module 9 business error codes required by the controlling guide. */
export const PROMOTION_ERROR_CODE = {
  PROMOTION_NOT_FOUND: "PROMOTION_NOT_FOUND",
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_LIMIT_REACHED: "COUPON_LIMIT_REACHED",
  PROMOTION_SCOPE_FORBIDDEN: "PROMOTION_SCOPE_FORBIDDEN",
} as const;

/** Durable Module 9 events named by the controlling guide. */
export const PROMOTION_OUTBOX_EVENT = {
  CREATED: "promotion.created",
  ACTIVATED: "promotion.activated",
  DEACTIVATED: "promotion.deactivated",
  COUPON_REDEEMED: "coupon.redeemed",
} as const;

/** Promotion ownership values persisted by the Module 9 database contract. */
export const PROMOTION_OWNER_TYPE = {
  PLATFORM: "platform",
  SELLER: "seller",
} as const;

export const PROMOTION_OWNER_TYPE_VALUES = [
  PROMOTION_OWNER_TYPE.PLATFORM,
  PROMOTION_OWNER_TYPE.SELLER,
] as const;

/** Promotion lifecycle values persisted by the Module 9 database contract. */
export const PROMOTION_STATUS = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const PROMOTION_STATUS_VALUES = [
  PROMOTION_STATUS.DRAFT,
  PROMOTION_STATUS.SCHEDULED,
  PROMOTION_STATUS.ACTIVE,
  PROMOTION_STATUS.INACTIVE,
] as const;

/** Discount funding owners kept separate from the actor who created a promotion. */
export const PROMOTION_FUNDING_TYPE = {
  PLATFORM: "platform",
  SELLER: "seller",
} as const;

export const PROMOTION_FUNDING_TYPE_VALUES = [
  PROMOTION_FUNDING_TYPE.PLATFORM,
  PROMOTION_FUNDING_TYPE.SELLER,
] as const;

/** Coupon lifecycle values persisted by the Module 9 database contract. */
export const COUPON_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const COUPON_STATUS_VALUES = [
  COUPON_STATUS.ACTIVE,
  COUPON_STATUS.INACTIVE,
] as const;

/**
 * Eligibility target kinds supported by the current source guide.
 * Customer/cart context is derived from the authenticated cart rather than accepted as an arbitrary scope ID.
 */
export const PROMOTION_SCOPE_TYPE = {
  SELLER: "seller",
  STORE: "store",
  CATEGORY: "category",
  PRODUCT: "product",
} as const;

export const PROMOTION_SCOPE_TYPE_VALUES = [
  PROMOTION_SCOPE_TYPE.SELLER,
  PROMOTION_SCOPE_TYPE.STORE,
  PROMOTION_SCOPE_TYPE.CATEGORY,
  PROMOTION_SCOPE_TYPE.PRODUCT,
] as const;

/** Database-aligned text/decimal and collection limits shared by Module 9 contracts. */
export const PROMOTION_LIMITS = {
  NAME_MAX_LENGTH: 200,
  TYPE_MAX_LENGTH: 40,
  VALUE_PRECISION: 18,
  VALUE_SCALE: 4,
  COUPON_CODE_MAX_LENGTH: 120,
  MAX_SCOPES_PER_PROMOTION: 100,
  MAX_COUPON_USES: 2_147_483_647,
} as const;
