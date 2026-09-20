import type { AdminPromotionListParams } from "../schemas/promotions.schemas";

/** Stable TanStack Query keys for Module 9 Promotions & Coupons server state. */
export const promotionsQueryKeys = {
  all: ["promotions"] as const,
  admin: ["promotions", "admin"] as const,
  adminList: (params: AdminPromotionListParams) => ["promotions", "admin", "list", params] as const,
};
