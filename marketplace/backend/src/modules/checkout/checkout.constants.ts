/** Stable Module 10 permissions named by the controlling Checkout contract. */
export const CHECKOUT_PERMISSION = {
  CREATE_OWN: "checkout.create_own",
  CONFIRM_OWN: "checkout.confirm_own",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const CHECKOUT_PERMISSION_CATALOG = [
  {
    code: CHECKOUT_PERMISSION.CREATE_OWN,
    domain: "checkout",
    description: "Create and read the authenticated customer's authoritative Checkout quote.",
  },
  {
    code: CHECKOUT_PERMISSION.CONFIRM_OWN,
    domain: "checkout",
    description: "Confirm and read the authenticated customer's Checkout attempt status.",
  },
] as const;

/** Stable Module 10 business error codes required by the controlling guide. */
export const CHECKOUT_ERROR_CODE = {
  QUOTE_EXPIRED: "CHECKOUT_QUOTE_EXPIRED",
  PRICE_CHANGED: "CHECKOUT_PRICE_CHANGED",
  STOCK_CHANGED: "CHECKOUT_STOCK_CHANGED",
  PROMOTION_CHANGED: "CHECKOUT_PROMOTION_CHANGED",
  ADDRESS_INVALID: "CHECKOUT_ADDRESS_INVALID",
  IDEMPOTENCY_CONFLICT: "CHECKOUT_IDEMPOTENCY_CONFLICT",
} as const;


/** Persisted quote source keeps normal Cart checkout and single-item Buy Now revalidation distinct. */
export const CHECKOUT_SOURCE = {
  CART: "cart",
  BUY_NOW: "buy_now",
} as const;

export const CHECKOUT_SOURCE_VALUES = Object.values(CHECKOUT_SOURCE) as [
  (typeof CHECKOUT_SOURCE)[keyof typeof CHECKOUT_SOURCE],
  ...(typeof CHECKOUT_SOURCE)[keyof typeof CHECKOUT_SOURCE][],
];

/** Checkout-attempt lifecycle values Module 10 is allowed to write. */
export const CHECKOUT_ATTEMPT_STATUS = {
  CONFIRMED: "confirmed",
  EXPIRED: "expired",
  FAILED: "failed",
} as const;

/** Fixed state-hash version required by approved Requirements Patch 0004. */
export const CHECKOUT_STATE_VERSION = "checkout-state-v1" as const;

/** Fixed confirmation request-hash version required by approved Requirements Patch 0004. */
export const CHECKOUT_CONFIRM_REQUEST_VERSION = "checkout-confirm-v1" as const;

/** Customer-scoped Foundation idempotency prefix used by Checkout confirmation. */
export const CHECKOUT_IDEMPOTENCY_SCOPE_PREFIX = "checkout.confirm" as const;

/** Durable Module 10 events named by the controlling guide. */
export const CHECKOUT_OUTBOX_EVENT = {
  QUOTED: "checkout.quoted",
  CONFIRMED: "checkout.confirmed",
  EXPIRED: "checkout.expired",
  FAILED: "checkout.failed",
} as const;

/** Exact Module 10 HTTP paths approved by the controlling guide. */
export const CHECKOUT_PATH = {
  CREATE_QUOTE: "/api/v1/checkout/quote",
  READ_QUOTE: "/api/v1/checkout/quote/:id",
  CONFIRM_QUOTE: "/api/v1/checkout/quote/:id/confirm",
  READ_ATTEMPT_STATUS: "/api/v1/checkout/:attemptId/status",
} as const;

/** Database-aligned text and exact-decimal limits shared by source-supported Checkout contracts. */
export const CHECKOUT_LIMITS = {
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  STATE_HASH_LENGTH: 64,
  ATTEMPT_STATUS_MAX_LENGTH: 40,
  IDEMPOTENCY_KEY_MAX_LENGTH: 200,
  COUPON_CODE_MAX_LENGTH: 120,
  SHIPPING_METHOD_CODE_MAX_LENGTH: 120,
  SHIPPING_METHOD_NAME_MAX_LENGTH: 200,
  MAX_ITEM_QUANTITY: 99,
} as const;
