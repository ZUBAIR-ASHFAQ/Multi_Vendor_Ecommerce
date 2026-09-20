import type { CustomerListParams } from "../types/customers.types";

/** Stable Module 3 query keys keep customer server state inside TanStack Query. */
export const customerQueryKeys = {
  profile: ["customers", "me", "profile"] as const,
  addresses: ["customers", "me", "addresses"] as const,
  adminList: (params: CustomerListParams) => ["customers", "admin", "list", params] as const,
  adminDetail: (id: string) => ["customers", "admin", "detail", id] as const,
};
