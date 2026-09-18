/** Permissions used only to control Shipping UI visibility; the backend remains authoritative. */
export const SHIPPING_PERMISSION = {
  READ_OWN_ORDER: "shipping.read_own_order",
  SELLER_READ: "seller.shipping.read",
  SELLER_MANAGE: "seller.shipping.manage",
  ADMIN_READ: "admin.shipping.read",
} as const;

/** Human-readable labels for the three server-owned Shipment lifecycle states. */
export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  created: "Created",
  shipped: "Shipped",
  delivered: "Delivered",
};
