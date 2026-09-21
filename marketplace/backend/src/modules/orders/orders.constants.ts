/** Stable Module 11 permissions named by the controlling Orders contract. */
export const ORDERS_PERMISSION = {
  READ_OWN: "orders.read_own",
  SELLER_READ: "seller.orders.read",
  SELLER_MANAGE: "seller.orders.manage",
  ADMIN_READ: "admin.orders.read",
  ADMIN_CANCEL: "admin.orders.cancel",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed later in Module 11. */
export const ORDERS_PERMISSION_CATALOG = [
  {
    code: ORDERS_PERMISSION.READ_OWN,
    domain: "orders",
    description: "Read and cancel the authenticated customer's own Orders where policy allows.",
  },
  {
    code: ORDERS_PERMISSION.SELLER_READ,
    domain: "orders",
    description: "Read Seller Orders inside the actor's approved seller/store scope.",
  },
  {
    code: ORDERS_PERMISSION.SELLER_MANAGE,
    domain: "orders",
    description: "Accept and process Seller Orders inside the actor's approved seller/store scope.",
  },
  {
    code: ORDERS_PERMISSION.ADMIN_READ,
    domain: "orders",
    description: "Search Customer Orders for authorized platform support and operations.",
  },
  {
    code: ORDERS_PERMISSION.ADMIN_CANCEL,
    domain: "orders",
    description: "Perform privileged Order cancellation where the lifecycle still permits it.",
  },
] as const;

/** Stable Module 11 business error codes required by the controlling guide. */
export const ORDERS_ERROR_CODE = {
  NOT_FOUND: "ORDER_NOT_FOUND",
  STATUS_INVALID: "ORDER_STATUS_INVALID",
  SELLER_SCOPE_FORBIDDEN: "SELLER_ORDER_SCOPE_FORBIDDEN",
  CANCELLATION_NOT_ALLOWED: "ORDER_CANCELLATION_NOT_ALLOWED",
  SOURCE_DUPLICATE: "ORDER_SOURCE_DUPLICATE",
} as const;

/** Customer Order payment states Module 11 is allowed to initialize or consume from the trusted payment boundary. */
export const ORDER_PAYMENT_STATUS = {
  PENDING: "pending",
  CAPTURED: "captured",
} as const;

export const ORDER_PAYMENT_STATUS_VALUES = [
  ORDER_PAYMENT_STATUS.PENDING,
  ORDER_PAYMENT_STATUS.CAPTURED,
] as const;

/** Customer Order fulfillment states completed by Stage 16 Module 13 Shipping. */
export const ORDER_FULFILLMENT_STATUS = {
  UNFULFILLED: "unfulfilled",
  PARTIALLY_FULFILLED: "partially_fulfilled",
  FULFILLED: "fulfilled",
} as const;

export const ORDER_FULFILLMENT_STATUS_VALUES = [
  ORDER_FULFILLMENT_STATUS.UNFULFILLED,
  ORDER_FULFILLMENT_STATUS.PARTIALLY_FULFILLED,
  ORDER_FULFILLMENT_STATUS.FULFILLED,
] as const;

/** Parent Customer Order states derived by Module 11 from payment, child Seller Orders, and item quantities. */
export const ORDER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  CANCELLED: "cancelled",
} as const;

export const ORDER_STATUS_VALUES = [
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.CANCELLED,
] as const;

/** Seller Order states owned by Module 11 before later fulfillment modules add their own transitions. */
export const SELLER_ORDER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  PENDING_ACCEPTANCE: "pending_acceptance",
  PROCESSING: "processing",
  CANCELLED: "cancelled",
} as const;

export const SELLER_ORDER_STATUS_VALUES = [
  SELLER_ORDER_STATUS.PENDING_PAYMENT,
  SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
  SELLER_ORDER_STATUS.PROCESSING,
  SELLER_ORDER_STATUS.CANCELLED,
] as const;

/** Order Item cancellation states owned by Module 11. */
export const ORDER_ITEM_STATUS = {
  ACTIVE: "active",
  PARTIALLY_CANCELLED: "partially_cancelled",
  CANCELLED: "cancelled",
} as const;

export const ORDER_ITEM_STATUS_VALUES = [
  ORDER_ITEM_STATUS.ACTIVE,
  ORDER_ITEM_STATUS.PARTIALLY_CANCELLED,
  ORDER_ITEM_STATUS.CANCELLED,
] as const;

/** Durable Module 11 events named by the controlling guide. */
export const ORDERS_OUTBOX_EVENT = {
  CREATED: "order.created",
  PAYMENT_CONFIRMED: "order.payment_confirmed",
  SELLER_ORDER_CREATED: "seller_order.created",
  SELLER_ORDER_ACCEPTED: "seller_order.accepted",
  CANCELLED: "order.cancelled",
  STATUS_CHANGED: "order.status_changed",
} as const;

/** Stable source type used by the replay-safe trusted Payment-confirmed transition. */
export const ORDER_SOURCE_TYPE = {
  PAYMENT_CONFIRMED: "payment_confirmed",
  PAYMENT_EXPIRED: "payment_expired",
} as const;

/** Foundation idempotency scope prefixes frozen by approved Requirements Patch 0005. */
export const ORDER_IDEMPOTENCY_SCOPE = {
  CUSTOMER_CANCEL: "orders.cancel",
  ADMIN_CANCEL: "orders.admin-cancel",
} as const;

/** Fixed cancellation request-hash version frozen by approved Requirements Patch 0005. */
export const ORDER_CANCEL_REQUEST_VERSION = "orders-cancel-v1" as const;

/** Allow-listed customer/admin Customer Order list sort fields. */
export const ORDER_LIST_SORT_VALUES = ["createdAt", "orderNo"] as const;

/** Allow-listed Seller Order list sort fields. */
export const SELLER_ORDER_LIST_SORT_VALUES = ["createdAt", "sellerOrderNo"] as const;

/** Shared allow-listed ascending/descending sort direction. */
export const ORDER_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Database-aligned limits shared by Module 11 contracts and future service validation. */
export const ORDERS_LIMITS = {
  CUSTOMER_LIST_ITEM_PREVIEW_MAX: 3,
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  ORDER_NUMBER_MAX_LENGTH: 40,
  STATUS_MAX_LENGTH: 40,
  IDEMPOTENCY_KEY_MAX_LENGTH: 200,
  PAYMENT_SOURCE_KEY_MAX_LENGTH: 200,
  CANCELLATION_REASON_MAX_LENGTH: 500,
  SKU_MAX_LENGTH: 120,
  PRODUCT_NAME_MAX_LENGTH: 240,
  VARIANT_TITLE_MAX_LENGTH: 200,
  SHIPPING_METHOD_CODE_MAX_LENGTH: 120,
  SHIPPING_METHOD_NAME_MAX_LENGTH: 200,
  RECIPIENT_NAME_MAX_LENGTH: 200,
  PHONE_MAX_LENGTH: 32,
  ADDRESS_LINE_MAX_LENGTH: 255,
  CITY_MAX_LENGTH: 120,
  REGION_MAX_LENGTH: 120,
  POSTAL_CODE_MAX_LENGTH: 32,
  COUNTRY_CODE_LENGTH: 2,
} as const;

/** Stable resource names used by Orders audit/outbox metadata. */
export const ORDERS_RESOURCE_TYPE = {
  ORDER: "order",
  SELLER_ORDER: "seller_order",
} as const;

/** Concise audit actions for Module 11 lifecycle writes and replay conflicts. */
export const ORDERS_AUDIT_ACTION = {
  CREATED: "order.created",
  PAYMENT_CONFIRMED: "order.payment_confirmed",
  PAYMENT_EXPIRED: "order.payment_expired",
  SELLER_ORDER_ACCEPTED: "seller_order.accepted",
  CUSTOMER_CANCELLED: "order.customer_cancelled",
  ADMIN_CANCELLED: "order.admin_cancelled",
  SOURCE_CONFLICT: "order.source_conflict",
} as const;
