import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  InventoryItem,
  SellerInventoryListParams,
  StockMovement,
  StockMovementListParams,
} from "../schemas/inventory.schemas";

/** Removes unset Inventory filters and serializes booleans exactly as the backend query contract expects. */
function queryParams(value: Record<string, unknown>): Record<string, string | number> {
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== "")
    .map(([key, entry]) => [key, typeof entry === "boolean" ? String(entry) : entry]);
  return Object.fromEntries(entries) as Record<string, string | number>;
}

/** Unwraps one successful Inventory API envelope. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps one paginated Inventory API envelope and requires the shared pagination metadata. */
async function page<T>(
  request: Promise<{ data: ApiResponse<T[], PaginationMeta> }>,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Inventory pagination metadata is missing.");
  return { items: response.data.data, meta: response.data.meta };
}

export const inventoryApi = {
  /** Lists Inventory inside the authenticated seller/store scope. */
  listSellerInventory: (params: SellerInventoryListParams) =>
    page<InventoryItem>(apiClient.get("/seller/inventory", { params: queryParams(params) })),

  /** Lists immutable stock movements for one seller-owned Product variant. */
  listStockMovements: (variantId: string, params: StockMovementListParams) =>
    page<StockMovement>(
      apiClient.get(`/seller/inventory/${variantId}/movements`, { params: queryParams(params) }),
    ),

  /** Applies one controlled seller stock adjustment. */
  adjustStock: (variantId: string, quantityDelta: number) =>
    one<InventoryItem>(apiClient.post(`/seller/inventory/${variantId}/adjust`, { quantityDelta })),

  /** Updates or disables one seller-owned low-stock reorder threshold. */
  updateReorderLevel: (variantId: string, reorderLevel: number | null) =>
    one<InventoryItem>(
      apiClient.patch(`/seller/inventory/${variantId}/reorder-level`, { reorderLevel }),
    ),
};
