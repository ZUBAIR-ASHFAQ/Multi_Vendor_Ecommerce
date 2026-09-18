import type { PublicProductListParams, SellerProductListParams } from "../types/products.types";

/** Stable TanStack Query keys for all Module 6 frontend server state. */
export const productQueryKeys = {
  all: ["products"] as const,
  public: ["products", "public"] as const,
  publicList: (params: PublicProductListParams) => ["products", "public", "list", params] as const,
  publicDetail: (slug: string) => ["products", "public", "detail", slug] as const,
  seller: ["products", "seller"] as const,
  sellerList: (params: SellerProductListParams) => ["products", "seller", "list", params] as const,
  sellerDetail: (id: string) => ["products", "seller", "detail", id] as const,
};
