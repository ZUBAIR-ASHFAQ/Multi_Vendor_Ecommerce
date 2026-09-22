import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateInventoryCommerceState } from "@/lib/commerce-cache-invalidation";
import { inventoryApi } from "../api/inventory.api";
import type {
  SellerInventoryListParams,
  StockMovementListParams,
} from "../schemas/inventory.schemas";
import { inventoryQueryKeys } from "./inventory.query-keys";

/** Loads one seller-scoped Inventory page. */
export function useSellerInventoryQuery(params: SellerInventoryListParams, enabled = true) {
  return useQuery({
    queryKey: inventoryQueryKeys.sellerList(params),
    queryFn: () => inventoryApi.listSellerInventory(params),
    enabled,
  });
}

/** Loads one immutable stock-movement page for a seller-owned Product variant. */
export function useStockMovementsQuery(
  variantId: string,
  params: StockMovementListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: inventoryQueryKeys.movements(variantId, params),
    queryFn: () => inventoryApi.listStockMovements(variantId, params),
    enabled: enabled && variantId.length > 0,
  });
}

/** Applies one stock adjustment and refreshes Inventory plus movement history. */
export function useAdjustStockMutation(variantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quantityDelta: number) => inventoryApi.adjustStock(variantId, quantityDelta),
    onSuccess: async () => {
      await Promise.all([
        invalidateInventoryCommerceState(queryClient),
        queryClient.invalidateQueries({ queryKey: ["inventory", "seller", "movements", variantId] }),
      ]);
    },
  });
}

/** Updates one reorder threshold and refreshes seller Inventory pages. */
export function useUpdateReorderLevelMutation(variantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reorderLevel: number | null) =>
      inventoryApi.updateReorderLevel(variantId, reorderLevel),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.seller });
    },
  });
}
