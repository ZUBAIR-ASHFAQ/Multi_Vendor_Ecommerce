import type {
  SellerInventoryListParams,
  StockMovementListParams,
} from "../schemas/inventory.schemas";

/** Stable TanStack Query keys for Module 7 Inventory server state. */
export const inventoryQueryKeys = {
  all: ["inventory"] as const,
  seller: ["inventory", "seller"] as const,
  sellerList: (params: SellerInventoryListParams) => ["inventory", "seller", "list", params] as const,
  movements: (variantId: string, params: StockMovementListParams) =>
    ["inventory", "seller", "movements", variantId, params] as const,
};
