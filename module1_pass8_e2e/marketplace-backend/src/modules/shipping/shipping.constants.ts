/** Shipping-method ownership values defined by the Module 13 persistence contract. */
export const SHIPPING_OWNER_TYPE = {
  PLATFORM: "platform",
  SELLER: "seller",
} as const;

export const SHIPPING_OWNER_TYPE_VALUES = [
  SHIPPING_OWNER_TYPE.PLATFORM,
  SHIPPING_OWNER_TYPE.SELLER,
] as const;

/** Stage 11 supports one deliberately small pricing model. */
export const SHIPPING_PRICING_TYPE = {
  FLAT: "flat",
} as const;

export const SHIPPING_PRICING_TYPE_VALUES = [SHIPPING_PRICING_TYPE.FLAT] as const;

/** Stage 11 shipping-method lifecycle values. */
export const SHIPPING_METHOD_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const SHIPPING_METHOD_STATUS_VALUES = [
  SHIPPING_METHOD_STATUS.ACTIVE,
  SHIPPING_METHOD_STATUS.INACTIVE,
] as const;

/** Stage 16 Shipment lifecycle values frozen by Requirements Patch 0008. */
export const SHIPMENT_STATUS = {
  CREATED: "created",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
} as const;

export const SHIPMENT_STATUS_VALUES = [
  SHIPMENT_STATUS.CREATED,
  SHIPMENT_STATUS.SHIPPED,
  SHIPMENT_STATUS.DELIVERED,
] as const;

/** Customer tracking intentionally hides the internal created/preparation state. */
export const CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES = [
  SHIPMENT_STATUS.SHIPPED,
  SHIPMENT_STATUS.DELIVERED,
] as const;

/** Stable Module 13 permissions frozen by Requirements Patch 0008. */
export const SHIPPING_PERMISSION = {
  READ_OWN_ORDER: "shipping.read_own_order",
  SELLER_READ: "seller.shipping.read",
  SELLER_MANAGE: "seller.shipping.manage",
  ADMIN_READ: "admin.shipping.read",
} as const;

/** Module-owned permission catalog for later composition into central RBAC seeding. */
export const SHIPPING_PERMISSION_CATALOG = [
  {
    code: SHIPPING_PERMISSION.READ_OWN_ORDER,
    domain: "shipping",
    description: "Read tracking for the authenticated customer's own Orders.",
  },
  {
    code: SHIPPING_PERMISSION.SELLER_READ,
    domain: "shipping",
    description: "Read Shipments inside the actor's approved seller/store scope.",
  },
  {
    code: SHIPPING_PERMISSION.SELLER_MANAGE,
    domain: "shipping",
    description: "Create and progress Shipments inside the actor's approved seller/store scope.",
  },
  {
    code: SHIPPING_PERMISSION.ADMIN_READ,
    domain: "shipping",
    description: "Read customer-safe Shipment tracking for authorized platform support.",
  },
] as const;

/** Stable Module 13 business errors required by the controlling guide. */
export const SHIPPING_ERROR_CODE = {
  SHIPMENT_NOT_FOUND: "SHIPMENT_NOT_FOUND",
  SHIPMENT_QUANTITY_INVALID: "SHIPMENT_QUANTITY_INVALID",
  SHIPMENT_STATUS_INVALID: "SHIPMENT_STATUS_INVALID",
  TRACKING_INVALID: "TRACKING_INVALID",
  INVENTORY_ISSUE_FAILED: "INVENTORY_ISSUE_FAILED",
} as const;

/** Exact Module 13 HTTP identities approved by the guide and Requirements Patch 0008. */
export const SHIPPING_PATH = {
  OPTIONS: "/api/v1/checkout/shipping-options",
  SELLER_LIST: "/api/v1/seller/shipments",
  SELLER_CREATE: "/api/v1/seller/orders/:sellerOrderId/shipments",
  SELLER_TRACKING: "/api/v1/seller/shipments/:id/tracking",
  SELLER_MARK_SHIPPED: "/api/v1/seller/shipments/:id/mark-shipped",
  SELLER_MARK_DELIVERED: "/api/v1/seller/shipments/:id/mark-delivered",
  ORDER_SHIPMENTS: "/api/v1/orders/:orderId/shipments",
} as const;

/** Backward-compatible alias retained for the released Stage 11 Checkout integration. */
export const SHIPPING_CORE_PATH = {
  OPTIONS: SHIPPING_PATH.OPTIONS,
} as const;

/** Foundation idempotency scopes for retryable Shipment lifecycle commands. */
export const SHIPPING_IDEMPOTENCY_SCOPE = {
  CREATE: "shipping.create",
  MARK_SHIPPED: "shipping.mark-shipped",
  MARK_DELIVERED: "shipping.mark-delivered",
} as const;

/** Durable Module 13 events named by the controlling guide. */
export const SHIPPING_OUTBOX_EVENT = {
  CREATED: "shipment.created",
  SHIPPED: "shipment.shipped",
  DELIVERED: "shipment.delivered",
  TRACKING_UPDATED: "shipment.tracking_updated",
} as const;

/** Stable Shipping audit actions used by later service implementation. */
export const SHIPPING_AUDIT_ACTION = {
  CREATED: "shipment.created",
  SHIPPED: "shipment.shipped",
  DELIVERED: "shipment.delivered",
  TRACKING_UPDATED: "shipment.tracking_updated",
} as const;

/** Stable resource label used by Shipping audit/outbox metadata. */
export const SHIPPING_RESOURCE_TYPE = {
  SHIPMENT: "shipment",
} as const;

/** Allow-listed Seller Shipment list sort fields from Requirements Patch 0008. */
export const SHIPMENT_LIST_SORT_VALUES = ["createdAt", "shipmentNo"] as const;

/** Shared ascending/descending sort direction for Shipment lists. */
export const SHIPPING_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Database-aligned limits used by Shipping Configuration and fulfillment contracts. */
export const SHIPPING_LIMITS = {
  METHOD_CODE_MAX_LENGTH: 120,
  METHOD_NAME_MAX_LENGTH: 200,
  BASE_RATE_PRECISION: 18,
  BASE_RATE_SCALE: 4,
  CURRENCY_LENGTH: 3,
  SHIPMENT_NUMBER_MAX_LENGTH: 40,
  CARRIER_MAX_LENGTH: 120,
  SERVICE_LEVEL_MAX_LENGTH: 120,
  TRACKING_NUMBER_MAX_LENGTH: 200,
  STATUS_HISTORY_SOURCE_MAX_LENGTH: 80,
  STATUS_HISTORY_PAYLOAD_REF_MAX_LENGTH: 500,
  IDEMPOTENCY_KEY_MAX_LENGTH: 200,
} as const;

/** Backward-compatible Stage 11 limit name retained for existing callers/tests. */
export const SHIPPING_METHOD_LIMITS = {
  CODE_MAX_LENGTH: SHIPPING_LIMITS.METHOD_CODE_MAX_LENGTH,
  NAME_MAX_LENGTH: SHIPPING_LIMITS.METHOD_NAME_MAX_LENGTH,
  BASE_RATE_PRECISION: SHIPPING_LIMITS.BASE_RATE_PRECISION,
  BASE_RATE_SCALE: SHIPPING_LIMITS.BASE_RATE_SCALE,
  CURRENCY_LENGTH: SHIPPING_LIMITS.CURRENCY_LENGTH,
} as const;

/** Stable patterns shared by database, Zod and OpenAPI-facing contracts. */
export const SHIPPING_PATTERN = {
  CURRENCY: /^[A-Z]{3}$/,
  SHIPMENT_NUMBER: /^SHP-[0-9A-F]{32}$/,
} as const;
