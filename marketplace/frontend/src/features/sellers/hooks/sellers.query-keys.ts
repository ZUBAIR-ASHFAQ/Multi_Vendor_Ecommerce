import type { SellerApplicationListParams } from "../types/sellers.types";

const publicStoresKey = ["sellers", "public-store"] as const;

/** Stable TanStack Query keys for Module 4 server state. */
export const sellerQueryKeys = {
  all: ["sellers"] as const,
  mySeller: ["sellers", "me"] as const,
  applications: ["sellers", "applications"] as const,
  applicationList: (params: SellerApplicationListParams) =>
    ["sellers", "applications", params] as const,
  publicStores: publicStoresKey,
  publicStore: (slug: string) => [...publicStoresKey, slug] as const,
};
