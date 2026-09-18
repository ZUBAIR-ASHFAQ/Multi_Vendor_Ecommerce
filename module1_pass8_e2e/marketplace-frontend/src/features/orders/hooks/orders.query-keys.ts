import type { AdminOrdersParams, CustomerOrdersParams, SellerOrdersParams } from "../types/orders.types";

export const ordersQueryKeys = {
  all: ["orders"] as const,
  customerList: (params: CustomerOrdersParams) => ["orders", "customer", "list", params] as const,
  customerDetail: (id: string) => ["orders", "customer", "detail", id] as const,
  sellerList: (params: SellerOrdersParams) => ["orders", "seller", "list", params] as const,
  sellerDetail: (id: string) => ["orders", "seller", "detail", id] as const,
  adminList: (params: AdminOrdersParams) => ["orders", "admin", "list", params] as const,
};
