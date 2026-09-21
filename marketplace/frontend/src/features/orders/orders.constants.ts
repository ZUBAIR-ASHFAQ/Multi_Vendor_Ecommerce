/** Module 11 permissions used only for frontend convenience; the API remains authoritative. */
export const ORDERS_PERMISSION = {
  READ_OWN: "orders.read_own",
  SELLER_READ: "seller.orders.read",
  SELLER_MANAGE: "seller.orders.manage",
  ADMIN_READ: "admin.orders.read",
  ADMIN_CANCEL: "admin.orders.cancel",
} as const;

/** Parent Customer Order lifecycle values currently returned by Module 11. */
export const ORDER_STATUS = ["pending_payment", "confirmed", "processing", "cancelled"] as const;

/** Seller Order lifecycle values currently returned by Module 11. */
export const SELLER_ORDER_STATUS = ["pending_payment", "pending_acceptance", "processing", "cancelled"] as const;

/** Human-readable labels keep status rendering consistent across customer, seller, and admin pages. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  cancelled: "Cancelled",
  pending_acceptance: "Pending acceptance",
  unfulfilled: "Unfulfilled",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  shipped: "Shipped",
  delivered: "Delivered",
  captured: "Captured",
  pending: "Pending",
  active: "Active",
  partially_cancelled: "Partially cancelled",
};
