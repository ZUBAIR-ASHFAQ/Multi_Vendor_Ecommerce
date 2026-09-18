/** Return Request lifecycle approved for the core Module 14 workflow. */
export const RETURN_REQUEST_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECEIVED: "received",
  CLOSED: "closed",
} as const;

export const RETURN_REQUEST_STATUS_VALUES = [
  RETURN_REQUEST_STATUS.REQUESTED,
  RETURN_REQUEST_STATUS.APPROVED,
  RETURN_REQUEST_STATUS.REJECTED,
  RETURN_REQUEST_STATUS.RECEIVED,
  RETURN_REQUEST_STATUS.CLOSED,
] as const;

/** Customer-selectable Return reason codes approved by Requirements Patch 0009. */
export const RETURN_REASON_CODE = {
  DAMAGED: "damaged",
  DEFECTIVE: "defective",
  WRONG_ITEM: "wrong_item",
  NOT_AS_DESCRIBED: "not_as_described",
  CHANGED_MIND: "changed_mind",
  OTHER: "other",
} as const;

export const RETURN_REASON_CODE_VALUES = [
  RETURN_REASON_CODE.DAMAGED,
  RETURN_REASON_CODE.DEFECTIVE,
  RETURN_REASON_CODE.WRONG_ITEM,
  RETURN_REASON_CODE.NOT_AS_DESCRIBED,
  RETURN_REASON_CODE.CHANGED_MIND,
  RETURN_REASON_CODE.OTHER,
] as const;

/** Seller/support inspection values recorded only after a physical Return is received. */
export const RETURN_ITEM_CONDITION = {
  UNOPENED: "unopened",
  OPENED: "opened",
  DAMAGED: "damaged",
  DEFECTIVE: "defective",
  OTHER: "other",
} as const;

export const RETURN_ITEM_CONDITION_VALUES = [
  RETURN_ITEM_CONDITION.UNOPENED,
  RETURN_ITEM_CONDITION.OPENED,
  RETURN_ITEM_CONDITION.DAMAGED,
  RETURN_ITEM_CONDITION.DEFECTIVE,
  RETURN_ITEM_CONDITION.OTHER,
] as const;

/** Item outcomes keep refund money and physical restock behavior explicitly separate. */
export const RETURN_ITEM_RESOLUTION = {
  REFUND_RESTOCK: "refund_restock",
  REFUND_NO_RESTOCK: "refund_no_restock",
} as const;

export const RETURN_ITEM_RESOLUTION_VALUES = [
  RETURN_ITEM_RESOLUTION.REFUND_RESTOCK,
  RETURN_ITEM_RESOLUTION.REFUND_NO_RESTOCK,
] as const;

/** Internal business Refund progress stored while Module 12 owns provider state. */
export const RETURN_REFUND_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
} as const;

/** Module 14 permissions required by the controlling guide. */
export const RETURNS_PERMISSION = {
  CREATE_OWN: "returns.create_own",
  READ_OWN: "returns.read_own",
  SELLER_MANAGE: "seller.returns.manage",
  ADMIN_MANAGE: "admin.returns.manage",
  ADMIN_REFUNDS_ISSUE: "admin.refunds.issue",
} as const;

/** Module-owned permission catalog for later Pass 5 composition into the central RBAC seed. */
export const RETURNS_PERMISSION_CATALOG = [
  {
    code: RETURNS_PERMISSION.CREATE_OWN,
    domain: "returns",
    description: "Create a Return Request for the authenticated customer's eligible delivered Order items.",
  },
  {
    code: RETURNS_PERMISSION.READ_OWN,
    domain: "returns",
    description: "Read the authenticated customer's own Return Requests and refund progress.",
  },
  {
    code: RETURNS_PERMISSION.SELLER_MANAGE,
    domain: "returns",
    description: "Review, approve, reject, receive, and inspect Returns inside the actor's seller scope.",
  },
  {
    code: RETURNS_PERMISSION.ADMIN_MANAGE,
    domain: "returns",
    description: "Search and manage Returns using authorized platform support scope.",
  },
  {
    code: RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE,
    domain: "returns",
    description: "Execute the provider refund command for an eligible Return resolution.",
  },
] as const;

/** Stable Module 14 business error codes required by the controlling guide. */
export const RETURNS_ERROR_CODE = {
  NOT_ELIGIBLE: "RETURN_NOT_ELIGIBLE",
  WINDOW_EXPIRED: "RETURN_WINDOW_EXPIRED",
  STATUS_INVALID: "RETURN_STATUS_INVALID",
  REFUND_DUPLICATE: "REFUND_DUPLICATE",
  SCOPE_FORBIDDEN: "RETURN_SCOPE_FORBIDDEN",
} as const;

/** Exact Module 14 HTTP paths required by the controlling guide. */
export const RETURNS_PATH = {
  CREATE_FOR_ORDER: "/api/v1/orders/:orderId/returns",
  CUSTOMER_LIST: "/api/v1/returns",
  SELLER_LIST: "/api/v1/seller/returns",
  SELLER_APPROVE: "/api/v1/seller/returns/:id/approve",
  SELLER_REJECT: "/api/v1/seller/returns/:id/reject",
  SELLER_RECEIVE: "/api/v1/seller/returns/:id/receive",
  ISSUE_REFUND: "/api/v1/returns/:id/refund",
  ADMIN_LIST: "/api/v1/admin/returns",
} as const;

/** Durable domain events named by the Module 14 guide. */
export const RETURNS_OUTBOX_EVENT = {
  REQUESTED: "return.requested",
  APPROVED: "return.approved",
  REJECTED: "return.rejected",
  RECEIVED: "return.received",
  REFUND_REQUESTED: "refund.requested",
  REFUND_COMPLETED: "refund.completed",
  CLOSED: "return.closed",
} as const;

/** Stable audit actions mirror the meaningful Return and refund lifecycle writes. */
export const RETURNS_AUDIT_ACTION = {
  REQUESTED: "return.requested",
  APPROVED: "return.approved",
  REJECTED: "return.rejected",
  RECEIVED: "return.received",
  REFUND_REQUESTED: "refund.requested",
  REFUND_COMPLETED: "refund.completed",
  CLOSED: "return.closed",
} as const;

/** Shared resource labels used by audit/outbox metadata. */
export const RETURNS_RESOURCE_TYPE = {
  RETURN_REQUEST: "return_request",
  REFUND: "refund",
} as const;

/** Foundation idempotency scope used by the provider-refund orchestration command. */
export const RETURNS_IDEMPOTENCY_SCOPE = {
  REFUND: "returns.refund",
} as const;

/** Approved configurable Return-window key and safe bounds. */
export const RETURN_WINDOW_POLICY = {
  SETTING_KEY: "returns.window_days",
  DEFAULT_DAYS: 30,
  MIN_DAYS: 1,
  MAX_DAYS: 365,
} as const;

/** Allow-listed list sort fields keep customer/seller/admin queries bounded and predictable. */
export const RETURN_LIST_SORT_VALUES = ["requestedAt", "returnNo"] as const;

/** Shared ascending/descending list direction. */
export const RETURN_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Database-aligned and API-safety limits used by Module 14 boundary contracts. */
export const RETURNS_LIMITS = {
  RETURN_NUMBER_MAX_LENGTH: 40,
  STATUS_MAX_LENGTH: 40,
  REASON_CODE_MAX_LENGTH: 80,
  ITEM_CONDITION_MAX_LENGTH: 40,
  ITEM_RESOLUTION_MAX_LENGTH: 60,
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  CURRENCY_LENGTH: 3,
  PROVIDER_REF_MAX_LENGTH: 255,
  IDEMPOTENCY_KEY_MAX_LENGTH: 255,
  TRANSITION_REASON_MAX_LENGTH: 1000,
  NOTE_MAX_LENGTH: 2000,
  ITEMS_PER_REQUEST_MAX: 100,
} as const;

/** Stable normalized formats shared by persistence and Zod contracts. */
export const RETURNS_PATTERN = {
  CURRENCY: /^[A-Z]{3}$/,
} as const;
