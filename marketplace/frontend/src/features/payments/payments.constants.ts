/** Frontend convenience permissions for the Module 12 Payments read surfaces. */
export const PAYMENTS_PERMISSION = {
  READ_OWN: "payments.read_own",
  ADMIN_READ: "admin.payments.read",
} as const;

/** Provider-authoritative Payment states shown by the marketplace UI. */
export const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  CAPTURED: "captured",
  FAILED: "failed",
  CANCELLED: "cancelled",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
} as const;

/** Payment states that can still change while the browser waits for provider confirmation. */
export const PAYMENT_ACTIVE_STATUS = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PROCESSING,
] as const;
