import type { SellerShipmentListParams } from "../types/shipping.types";

export const shippingQueryKeys = {
  all: ["shipping"] as const,
  sellerList: (params: SellerShipmentListParams) => ["shipping", "seller", "list", params] as const,
  orderTracking: (orderId: string) => ["shipping", "order", orderId] as const,
};
