/** Balance buckets persisted by the Module 17 seller Wallet snapshot and immutable ledger. */
export const WALLET_BALANCE_BUCKET = {
  PENDING: "pending",
  AVAILABLE: "available",
  HELD: "held",
  NEGATIVE: "negative",
} as const;

export const WALLET_BALANCE_BUCKET_VALUES = [
  WALLET_BALANCE_BUCKET.PENDING,
  WALLET_BALANCE_BUCKET.AVAILABLE,
  WALLET_BALANCE_BUCKET.HELD,
  WALLET_BALANCE_BUCKET.NEGATIVE,
] as const;

/** Immutable Wallet-entry meanings frozen by Requirements Patch 0010. */
export const WALLET_ENTRY_TYPE = {
  COMMISSION_CREDIT: "commission_credit",
  COMMISSION_ADJUSTMENT: "commission_adjustment",
  AVAILABILITY_TRANSFER: "availability_transfer",
  NEGATIVE_RECOVERY: "negative_recovery",
  PAYOUT_RESERVE: "payout_reserve",
  PAYOUT_RELEASE: "payout_release",
  PAYOUT_PAID: "payout_paid",
} as const;

export const WALLET_ENTRY_TYPE_VALUES = [
  WALLET_ENTRY_TYPE.COMMISSION_CREDIT,
  WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT,
  WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
  WALLET_ENTRY_TYPE.NEGATIVE_RECOVERY,
  WALLET_ENTRY_TYPE.PAYOUT_RESERVE,
  WALLET_ENTRY_TYPE.PAYOUT_RELEASE,
  WALLET_ENTRY_TYPE.PAYOUT_PAID,
] as const;

/** Payout-account lifecycle values for provider-validated tokenized destinations. */
export const PAYOUT_ACCOUNT_STATUS = {
  ACTIVE: "active",
  DISABLED: "disabled",
} as const;

export const PAYOUT_ACCOUNT_STATUS_VALUES = [
  PAYOUT_ACCOUNT_STATUS.ACTIVE,
  PAYOUT_ACCOUNT_STATUS.DISABLED,
] as const;

/** Explicit Payout lifecycle used by request, finance approval, provider send, and reconciliation. */
export const PAYOUT_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
} as const;

export const PAYOUT_STATUS_VALUES = [
  PAYOUT_STATUS.REQUESTED,
  PAYOUT_STATUS.APPROVED,
  PAYOUT_STATUS.PROCESSING,
  PAYOUT_STATUS.PAID,
  PAYOUT_STATUS.FAILED,
] as const;

/** Allowed Payout lifecycle transitions; terminal states intentionally have no outgoing command. */
export const PAYOUT_STATUS_TRANSITIONS = {
  [PAYOUT_STATUS.REQUESTED]: [PAYOUT_STATUS.APPROVED],
  [PAYOUT_STATUS.APPROVED]: [PAYOUT_STATUS.PROCESSING],
  [PAYOUT_STATUS.PROCESSING]: [PAYOUT_STATUS.PAID, PAYOUT_STATUS.FAILED],
  [PAYOUT_STATUS.PAID]: [],
  [PAYOUT_STATUS.FAILED]: [],
} as const;

/** Provider adapter terminal/uncertain outcomes used later by the service boundary. */
export const PAYOUT_PROVIDER_RESULT = {
  PAID: "paid",
  FAILED: "failed",
  UNKNOWN: "unknown",
} as const;

export const PAYOUT_PROVIDER_RESULT_VALUES = [
  PAYOUT_PROVIDER_RESULT.PAID,
  PAYOUT_PROVIDER_RESULT.FAILED,
  PAYOUT_PROVIDER_RESULT.UNKNOWN,
] as const;

/** Module 17 permissions required by the controlling guide. */
export const WALLET_PAYOUT_PERMISSION = {
  SELLER_WALLET_READ: "seller.wallet.read",
  SELLER_PAYOUT_REQUEST: "seller.payout.request",
  SELLER_PAYOUT_ACCOUNT_MANAGE: "seller.payout_account.manage",
  ADMIN_PAYOUTS_READ: "admin.payouts.read",
  ADMIN_PAYOUTS_MANAGE: "admin.payouts.manage",
} as const;

/** Module-owned permission catalog for later composition into the central RBAC seed. */
export const WALLET_PAYOUT_PERMISSION_CATALOG = [
  {
    code: WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ,
    domain: "wallet",
    description: "Read the authenticated seller's Wallet balances and immutable ledger.",
  },
  {
    code: WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST,
    domain: "payouts",
    description: "Request a Payout from the authenticated seller's available Wallet balance.",
  },
  {
    code: WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE,
    domain: "payouts",
    description: "Add and manage tokenized payout-account references for the authenticated seller.",
  },
  {
    code: WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ,
    domain: "payouts",
    description: "Read the finance Payout queue and reconciliation-safe Payout details.",
  },
  {
    code: WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE,
    domain: "payouts",
    description: "Approve reserved Payouts and execute provider payout commands.",
  },
] as const;

/** Stable Module 17 business error codes required by the controlling guide. */
export const WALLET_PAYOUT_ERROR_CODE = {
  INSUFFICIENT_AVAILABLE_BALANCE: "INSUFFICIENT_AVAILABLE_BALANCE",
  PAYOUT_ACCOUNT_INVALID: "PAYOUT_ACCOUNT_INVALID",
  PAYOUT_STATUS_INVALID: "PAYOUT_STATUS_INVALID",
  WALLET_SOURCE_DUPLICATE: "WALLET_SOURCE_DUPLICATE",
  PAYOUT_PROVIDER_ERROR: "PAYOUT_PROVIDER_ERROR",
} as const;

/** Exact nine-operation Module 17 HTTP surface required by the controlling guide. */
export const WALLET_PAYOUT_PATH = {
  SELLER_WALLET: "/api/v1/seller/wallet",
  SELLER_PAYOUTS: "/api/v1/seller/payouts",
  SELLER_PAYOUT_REQUEST: "/api/v1/seller/payouts",
  SELLER_PAYOUT_ACCOUNT_CREATE: "/api/v1/seller/payout-accounts",
  ADMIN_PAYOUTS: "/api/v1/admin/payouts",
  ADMIN_PAYOUT_APPROVE: "/api/v1/admin/payouts/:id/approve",
  ADMIN_PAYOUT_SEND: "/api/v1/admin/payouts/:id/send",
  INTERNAL_WALLET_SETTLE: "/api/v1/internal/wallet/settle",
  INTERNAL_WALLET_ADJUST: "/api/v1/internal/wallet/adjust",
} as const;

/** Exact method + path pairs keep the nine-operation HTTP contract unambiguous. */
export const WALLET_PAYOUT_HTTP_OPERATION = [
  { method: "GET", path: WALLET_PAYOUT_PATH.SELLER_WALLET },
  { method: "GET", path: WALLET_PAYOUT_PATH.SELLER_PAYOUTS },
  { method: "POST", path: WALLET_PAYOUT_PATH.SELLER_PAYOUT_REQUEST },
  { method: "POST", path: WALLET_PAYOUT_PATH.SELLER_PAYOUT_ACCOUNT_CREATE },
  { method: "GET", path: WALLET_PAYOUT_PATH.ADMIN_PAYOUTS },
  { method: "POST", path: WALLET_PAYOUT_PATH.ADMIN_PAYOUT_APPROVE },
  { method: "POST", path: WALLET_PAYOUT_PATH.ADMIN_PAYOUT_SEND },
  { method: "POST", path: WALLET_PAYOUT_PATH.INTERNAL_WALLET_SETTLE },
  { method: "POST", path: WALLET_PAYOUT_PATH.INTERNAL_WALLET_ADJUST },
] as const;

/** Durable domain events named by the Module 17 guide. */
export const WALLET_PAYOUT_OUTBOX_EVENT = {
  WALLET_CREDITED: "wallet.credited",
  WALLET_AVAILABLE: "wallet.available",
  WALLET_ADJUSTED: "wallet.adjusted",
  PAYOUT_REQUESTED: "payout.requested",
  PAYOUT_PAID: "payout.paid",
  PAYOUT_FAILED: "payout.failed",
} as const;

/** Stable audit action names for security- and money-sensitive Module 17 changes. */
export const WALLET_PAYOUT_AUDIT_ACTION = {
  PAYOUT_ACCOUNT_CREATED: "payout_account.created",
  PAYOUT_REQUESTED: "payout.requested",
  PAYOUT_APPROVED: "payout.approved",
  PAYOUT_SEND_REQUESTED: "payout.send_requested",
  PAYOUT_PAID: "payout.paid",
  PAYOUT_FAILED: "payout.failed",
  WALLET_SETTLED: "wallet.settled",
  WALLET_ADJUSTED: "wallet.adjusted",
} as const;

/** Resource labels used by future audit and outbox metadata. */
export const WALLET_PAYOUT_RESOURCE_TYPE = {
  WALLET: "seller_wallet",
  WALLET_ENTRY: "seller_wallet_entry",
  PAYOUT_ACCOUNT: "payout_account",
  PAYOUT: "payout",
} as const;

/** Foundation idempotency scopes for retryable Module 17 money commands. */
export const WALLET_PAYOUT_IDEMPOTENCY_SCOPE = {
  PAYOUT_REQUEST: "wallet-payouts.payout-request",
  PAYOUT_APPROVE: "wallet-payouts.payout-approve",
  PAYOUT_SEND: "wallet-payouts.payout-send",
  WALLET_SETTLE: "wallet-payouts.wallet-settle",
  WALLET_ADJUST: "wallet-payouts.wallet-adjust",
} as const;

/** BullMQ names owned by Module 17 so producers, schedulers, and workers cannot drift. */
export const WALLET_PAYOUT_JOB = {
  /** Independent Foundation outbox destination for Commission source events. */
  SOURCE_EVENT_QUEUE: "wallet-source-events",
  /** Independent queue for bounded pending-to-available settlement scans. */
  SETTLEMENT_QUEUE: "wallet-settlement",
  /** Stable BullMQ job name for one bounded settlement scan. */
  SETTLE_ELIGIBLE: "settle-eligible",
} as const;

/** Allow-listed ledger ordering fields. */
export const WALLET_LEDGER_SORT_VALUES = ["occurredAt"] as const;

/** Allow-listed seller/admin Payout ordering fields. */
export const PAYOUT_LIST_SORT_VALUES = ["requestedAt", "payoutNo"] as const;

/** Shared ascending/descending list direction. */
export const WALLET_PAYOUT_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;

/** Database-aligned and API-safety limits used by Module 17 contracts. */
export const WALLET_PAYOUT_LIMITS = {
  PAYOUT_NUMBER_MAX_LENGTH: 40,
  ENTRY_TYPE_MAX_LENGTH: 40,
  BALANCE_BUCKET_MAX_LENGTH: 30,
  SOURCE_TYPE_MAX_LENGTH: 50,
  SOURCE_KEY_MAX_LENGTH: 255,
  PROVIDER_TYPE_MAX_LENGTH: 40,
  MASKED_DETAILS_MAX_LENGTH: 255,
  PROVIDER_ACCOUNT_REF_MAX_LENGTH: 255,
  ACCOUNT_STATUS_MAX_LENGTH: 30,
  PAYOUT_STATUS_MAX_LENGTH: 40,
  PROVIDER_REF_MAX_LENGTH: 255,
  MONEY_PRECISION: 18,
  MONEY_SCALE: 4,
  CURRENCY_LENGTH: 3,
  IDEMPOTENCY_KEY_MAX_LENGTH: 255,
  SETTLEMENT_LIMIT_DEFAULT: 100,
  SETTLEMENT_LIMIT_MIN: 1,
  SETTLEMENT_LIMIT_MAX: 500,
} as const;

/** Stable normalized formats shared by persistence and Zod contracts. */
export const WALLET_PAYOUT_PATTERN = {
  CURRENCY: /^[A-Z]{3}$/,
  PROVIDER_TYPE: /^[a-z][a-z0-9_-]*$/,
} as const;
