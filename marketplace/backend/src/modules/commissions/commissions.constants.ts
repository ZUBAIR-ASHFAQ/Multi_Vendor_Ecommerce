/** Stable Module 16 permissions named by the controlling Commissions guide. */
export const COMMISSIONS_PERMISSION = {
  ADMIN_MANAGE: "admin.commissions.manage",
  ADMIN_READ: "admin.commissions.read",
  SELLER_READ: "seller.commissions.read",
} as const;

/** Module-owned permission catalog composed into platform RBAC. */
export const COMMISSIONS_PERMISSION_CATALOG = [
  {
    code: COMMISSIONS_PERMISSION.ADMIN_MANAGE,
    domain: "commissions",
    description: "Create and update future-effective marketplace Commission rules.",
  },
  {
    code: COMMISSIONS_PERMISSION.ADMIN_READ,
    domain: "commissions",
    description: "Read Commission rules and the finance Commission ledger.",
  },
  {
    code: COMMISSIONS_PERMISSION.SELLER_READ,
    domain: "commissions",
    description: "Read only the authenticated seller's Commission statement.",
  },
] as const;

/** Stable Module 16 business error codes required by the controlling guide. */
export const COMMISSIONS_ERROR_CODE = {
  RULE_INVALID: "COMMISSION_RULE_INVALID",
  RULE_AMBIGUOUS: "COMMISSION_RULE_AMBIGUOUS",
  SOURCE_DUPLICATE: "COMMISSION_SOURCE_DUPLICATE",
  SCOPE_FORBIDDEN: "COMMISSION_SCOPE_FORBIDDEN",
} as const;

/** Rule scope kinds explicitly supported by the Module 16 database contract. */
export const COMMISSION_RULE_SCOPE_TYPE = {
  DEFAULT: "default",
  SELLER: "seller",
  CATEGORY: "category",
  PRODUCT: "product",
} as const;

export const COMMISSION_RULE_SCOPE_TYPE_VALUES = [
  COMMISSION_RULE_SCOPE_TYPE.DEFAULT,
  COMMISSION_RULE_SCOPE_TYPE.SELLER,
  COMMISSION_RULE_SCOPE_TYPE.CATEGORY,
  COMMISSION_RULE_SCOPE_TYPE.PRODUCT,
] as const;

/** Rule lifecycle states frozen by Requirements Patch 0007. */
export const COMMISSION_RULE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const COMMISSION_RULE_STATUS_VALUES = [
  COMMISSION_RULE_STATUS.ACTIVE,
  COMMISSION_RULE_STATUS.INACTIVE,
] as const;

/** Append-only Commission ledger entry kinds required by the guide. */
export const COMMISSION_ENTRY_TYPE = {
  SALE: "sale",
  REFUND: "refund",
  ADJUSTMENT: "adjustment",
} as const;

export const COMMISSION_ENTRY_TYPE_VALUES = [
  COMMISSION_ENTRY_TYPE.SALE,
  COMMISSION_ENTRY_TYPE.REFUND,
  COMMISSION_ENTRY_TYPE.ADJUSTMENT,
] as const;

/** Foundation idempotency scopes keep trusted Commission command source keys independent and replay-safe. */
export const COMMISSION_IDEMPOTENCY_SCOPE = {
  ORDER_SETTLE: "commissions.order-settle",
  REFUND_ADJUST: "commissions.refund-adjust",
} as const;

/** Durable Module 16 events named by the controlling guide. */
export const COMMISSIONS_OUTBOX_EVENT = {
  RULE_CREATED: "commission.rule_created",
  POSTED: "commission.posted",
  ADJUSTED: "commission.adjusted",
} as const;

/** Allow-listed sort fields for the future admin rule list. */
export const COMMISSION_RULE_SORT_VALUES = ["priority", "startAt", "createdAt"] as const;

/** Allow-listed sort fields for seller/admin immutable Commission entries. */
export const COMMISSION_ENTRY_SORT_VALUES = ["occurredAt", "createdAt"] as const;

/** Shared sort directions for Module 16 list contracts. */
export const COMMISSION_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Persisted/API bounds copied from the Module 16 Drizzle database contract. */
export const COMMISSIONS_LIMITS = {
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  RATE_PRECISION: 9,
  RATE_SCALE: 6,
  RULE_SCOPE_TYPE_MAX_LENGTH: 30,
  ENTRY_TYPE_MAX_LENGTH: 30,
  SOURCE_KEY_MAX_LENGTH: 255,
} as const;

/** Active status alias used by settlement code while preserving the shared lifecycle enum. */
export const COMMISSION_RULE_ACTIVE_STATUS = COMMISSION_RULE_STATUS.ACTIVE;

/** Stable audit actions used by the Module 16 service. */
export const COMMISSIONS_AUDIT_ACTION = {
  RULE_CREATED: "commission.rule_created",
  RULE_UPDATED: "commission.rule_updated",
  ORDER_SETTLED: "commission.order_settled",
  REFUND_ADJUSTED: "commission.refund_adjusted",
  FINANCE_READ: "commission.finance_read",
} as const;

/** Stable resource labels used in audit and outbox metadata. */
export const COMMISSIONS_RESOURCE_TYPE = {
  RULE: "commission_rule",
  ENTRY: "commission_entry",
  ORDER: "order",
} as const;

/**
 * Pass 4 executable policy for source gaps that the base guide does not numerically define.
 * These values are intentionally explicit so later approved patches can replace them without hidden behavior.
 */
export const COMMISSION_CALCULATION_POLICY = {
  PRIORITY_DIRECTION: "higher_wins",
  ROUNDING: "half_up_scale_4",
  FIXED_FEE_UNIT: "per_order_item",
  SHIPPING_CREDIT_AMOUNT: "0.0000",
  SNAPSHOT_VERSION: 1,
} as const;
