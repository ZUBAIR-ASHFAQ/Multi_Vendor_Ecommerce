/** Stable Module 12 permissions named by the controlling Payments contract. */
export const PAYMENTS_PERMISSION = {
  READ_OWN: "payments.read_own",
  ADMIN_READ: "admin.payments.read",
  ADMIN_REFUND: "admin.payments.refund",
  SYSTEM_WEBHOOK: "system.payments.webhook",
} as const;

/** Module-owned permission catalog composed into platform RBAC with the Pass 5 HTTP layer. */
export const PAYMENTS_PERMISSION_CATALOG = [
  {
    code: PAYMENTS_PERMISSION.READ_OWN,
    domain: "payments",
    description: "Create/read the authenticated customer's own Order Payment state.",
  },
  {
    code: PAYMENTS_PERMISSION.ADMIN_READ,
    domain: "payments",
    description: "Search and inspect Payments for authorized finance/support users.",
  },
  {
    code: PAYMENTS_PERMISSION.ADMIN_REFUND,
    domain: "payments",
    description: "Authorize trusted refund orchestration without exposing a public refund route.",
  },
  {
    code: PAYMENTS_PERMISSION.SYSTEM_WEBHOOK,
    domain: "payments",
    description: "Process provider webhooks only after successful provider signature verification.",
  },
] as const;

/** Stable Module 12 business error codes required by the guide and approved Patch 0006. */
export const PAYMENTS_ERROR_CODE = {
  NOT_FOUND: "PAYMENT_NOT_FOUND",
  AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH",
  PROVIDER_ERROR: "PAYMENT_PROVIDER_ERROR",
  WEBHOOK_INVALID: "PAYMENT_WEBHOOK_INVALID",
  ALREADY_CAPTURED: "PAYMENT_ALREADY_CAPTURED",
  REFUND_AMOUNT_EXCEEDED: "REFUND_AMOUNT_EXCEEDED",
  WINDOW_EXPIRED: "PAYMENT_WINDOW_EXPIRED",
} as const;

/** Provider names supported by the core Module 12 release. */
export const PAYMENT_PROVIDER = {
  STRIPE: "stripe",
} as const;

export const PAYMENT_PROVIDER_VALUES = [PAYMENT_PROVIDER.STRIPE] as const;

/** Provider-neutral Payment aggregate states frozen by approved Patch 0006. */
export const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  CAPTURED: "captured",
  FAILED: "failed",
  CANCELLED: "cancelled",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
} as const;

export const PAYMENT_STATUS_VALUES = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PROCESSING,
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
] as const;

/** Append-only Payment transaction categories retained by the base guide. */
export const PAYMENT_TRANSACTION_TYPE = {
  INTENT: "intent",
  AUTHORIZE: "authorize",
  CAPTURE: "capture",
  REFUND: "refund",
  FAILURE: "failure",
} as const;

export const PAYMENT_TRANSACTION_TYPE_VALUES = [
  PAYMENT_TRANSACTION_TYPE.INTENT,
  PAYMENT_TRANSACTION_TYPE.AUTHORIZE,
  PAYMENT_TRANSACTION_TYPE.CAPTURE,
  PAYMENT_TRANSACTION_TYPE.REFUND,
  PAYMENT_TRANSACTION_TYPE.FAILURE,
] as const;

/** Payment transaction result states frozen by Patch 0006. */
export const PAYMENT_TRANSACTION_STATUS = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export const PAYMENT_TRANSACTION_STATUS_VALUES = [
  PAYMENT_TRANSACTION_STATUS.PENDING,
  PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
  PAYMENT_TRANSACTION_STATUS.FAILED,
] as const;

/** Durable webhook-processing states frozen by Patch 0006. */
export const PAYMENT_WEBHOOK_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  IGNORED: "ignored",
  FAILED: "failed",
} as const;

/** Signed Stripe event types that drive core Payment state changes. */
export const STRIPE_PAYMENT_WEBHOOK_EVENT = {
  PROCESSING: "payment_intent.processing",
  SUCCEEDED: "payment_intent.succeeded",
  FAILED: "payment_intent.payment_failed",
  CANCELLED: "payment_intent.canceled",
} as const;

export const STRIPE_PAYMENT_WEBHOOK_EVENT_VALUES = [
  STRIPE_PAYMENT_WEBHOOK_EVENT.PROCESSING,
  STRIPE_PAYMENT_WEBHOOK_EVENT.SUCCEEDED,
  STRIPE_PAYMENT_WEBHOOK_EVENT.FAILED,
  STRIPE_PAYMENT_WEBHOOK_EVENT.CANCELLED,
] as const;

/** Provider refund reasons allowed by the frozen internal refund command. */
export const PAYMENT_REFUND_REASON_VALUES = [
  "requested_by_customer",
  "duplicate",
  "fraudulent",
] as const;

/** Durable Module 12 events named by the controlling guide. */
export const PAYMENTS_OUTBOX_EVENT = {
  INTENT_CREATED: "payment.intent_created",
  CAPTURED: "payment.captured",
  FAILED: "payment.failed",
  REFUNDED: "payment.refunded",
  WEBHOOK_FAILED: "payment.webhook_failed",
} as const;


/** Stable audit action names for sensitive Payment and reconciliation operations. */
export const PAYMENTS_AUDIT_ACTION = {
  INTENT_CREATED: "payment.intent_created",
  REFUND_REQUESTED: "payment.refund_requested",
  REFUND_COMPLETED: "payment.refund_completed",
  REFUND_FAILED: "payment.refund_failed",
  WEBHOOK_FAILED: "payment.webhook_failed",
  RECONCILIATION_SUCCEEDED: "payment.reconciliation_succeeded",
  RECONCILIATION_FAILED: "payment.reconciliation_failed",
  PAYMENT_EXPIRED: "payment.expired",
  ADMIN_DETAIL_READ: "payment.admin_detail_read",
} as const;

/** Resource names written to the shared append-only audit log. */
export const PAYMENTS_RESOURCE_TYPE = {
  PAYMENT: "payment",
  PAYMENT_TRANSACTION: "payment_transaction",
  PAYMENT_WEBHOOK: "payment_webhook",
} as const;

/** Internal safe failure codes stored on webhook processing rows. */
export const PAYMENTS_RECONCILIATION_ERROR_CODE = {
  ORDER_CONFIRMATION_FAILED: "PAYMENT_ORDER_RECONCILIATION_REQUIRED",
  WEBHOOK_PROCESSING_FAILED: "PAYMENT_WEBHOOK_PROCESSING_FAILED",
} as const;

/** BullMQ queue/job names owned only by the Payments module. */
export const PAYMENTS_JOB = {
  QUEUE: "payments-reconciliation",
  CAPTURE_RECONCILIATION: "capture-order-reconciliation",
  REFUND_RECONCILIATION: "refund-provider-reconciliation",
  EXPIRE_UNPAID: "expire-unpaid-payment",
  OVERDUE_ORDER_SCAN: "scan-overdue-unpaid-orders",
} as const;

/** Allow-listed Payment admin sort fields and directions. */
export const PAYMENT_LIST_SORT_VALUES = ["createdAt", "updatedAt"] as const;
export const PAYMENT_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Stable request-hash/provider-key versions frozen by approved Patch 0006. */
export const PAYMENT_REQUEST_VERSION = {
  INTENT: "payments-intent-v1",
  REFUND: "payments-refund-v1",
} as const;

/** Foundation idempotency scope prefix used by Payment intent creation. */
export const PAYMENT_IDEMPOTENCY_SCOPE_PREFIX = "payments.intent" as const;

/** Database/API limits shared by Module 12 contracts. */
export const PAYMENTS_LIMITS = {
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  PROVIDER_MAX_LENGTH: 40,
  PROVIDER_ID_MAX_LENGTH: 255,
  STATUS_MAX_LENGTH: 40,
  EVENT_TYPE_MAX_LENGTH: 160,
  ERROR_CODE_MAX_LENGTH: 120,
  SOURCE_KEY_MAX_LENGTH: 200,
  IDEMPOTENCY_KEY_MAX_LENGTH: 200,
  WEBHOOK_SIGNATURE_MAX_LENGTH: 2000,
  AUDIT_NOTE_MAX_LENGTH: 500,
  HASH_LENGTH: 64,
} as const;
