import type {
  AdminReturnListParams,
  ReturnListParams,
  SellerReturnListParams,
} from "../types/returns-refunds.types";

/** Stable TanStack Query keys for Module 14 server state. */
export const returnsRefundsQueryKeys = {
  all: ["returns-refunds"] as const,
  customerList: (params: ReturnListParams) => ["returns-refunds", "customer", "list", params] as const,
  sellerList: (params: SellerReturnListParams) => ["returns-refunds", "seller", "list", params] as const,
  adminList: (params: AdminReturnListParams) => ["returns-refunds", "admin", "list", params] as const,
};
