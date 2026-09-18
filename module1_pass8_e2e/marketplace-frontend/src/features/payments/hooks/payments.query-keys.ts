import type { AdminPaymentsParams } from "../types/payments.types";

export const paymentsQueryKeys = {
  /** Returns the stable customer Payment query key for one parent Order. */
  customerStatus: (orderId: string) => ["payments", "customer", "order", orderId] as const,

  /** Returns the stable finance list query key for one allow-listed search request. */
  adminList: (params: AdminPaymentsParams) => ["payments", "admin", "list", params] as const,

  /** Returns the stable finance detail query key for one Payment aggregate. */
  adminDetail: (paymentId: string) => ["payments", "admin", "detail", paymentId] as const,
};
