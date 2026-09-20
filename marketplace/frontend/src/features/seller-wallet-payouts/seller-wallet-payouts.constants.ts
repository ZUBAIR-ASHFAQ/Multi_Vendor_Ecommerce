/** Module 17 permissions used for UI convenience only; backend policy remains authoritative. */
export const WALLET_PAYOUT_PERMISSION = {
  SELLER_WALLET_READ: "seller.wallet.read",
  SELLER_PAYOUT_REQUEST: "seller.payout.request",
  SELLER_PAYOUT_ACCOUNT_MANAGE: "seller.payout_account.manage",
  ADMIN_PAYOUTS_READ: "admin.payouts.read",
  ADMIN_PAYOUTS_MANAGE: "admin.payouts.manage",
} as const;

/** Wallet balance buckets returned by the backend snapshot. */
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

/** Human-readable Wallet bucket labels. */
export const WALLET_BALANCE_BUCKET_LABEL = {
  pending: "Pending",
  available: "Available",
  held: "Held",
  negative: "Negative",
} as const;

/** Immutable Wallet ledger entry kinds exposed by Module 17. */
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

/** Human-readable immutable ledger entry labels. */
export const WALLET_ENTRY_TYPE_LABEL = {
  commission_credit: "Commission credit",
  commission_adjustment: "Commission adjustment",
  availability_transfer: "Made available",
  negative_recovery: "Negative balance recovery",
  payout_reserve: "Payout reserved",
  payout_release: "Payout released",
  payout_paid: "Payout paid",
} as const;

/** Payout-account states returned by the safe account projection. */
export const PAYOUT_ACCOUNT_STATUS_VALUES = ["active", "disabled"] as const;

/** Payout lifecycle values frozen by the Module 17 backend contract. */
export const PAYOUT_STATUS_VALUES = [
  "requested",
  "approved",
  "processing",
  "paid",
  "failed",
] as const;

/** Human-readable Payout state labels. */
export const PAYOUT_STATUS_LABEL = {
  requested: "Requested",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
} as const;
