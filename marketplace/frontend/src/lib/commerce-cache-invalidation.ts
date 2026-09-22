import type { QueryClient } from "@tanstack/react-query";
import { inventoryQueryKeys } from "@/features/inventory/hooks/inventory.query-keys";
import { productQueryKeys } from "@/features/products/hooks/products.query-keys";
import { reviewsQueryKeys } from "@/features/reviews/hooks/reviews.query-keys";
import { searchDiscoveryQueryKeys } from "@/features/search-discovery/hooks/search-discovery.query-keys";
import { sellerQueryKeys } from "@/features/sellers/hooks/sellers.query-keys";

interface ProductCommerceInvalidationOptions {
  includeAdmin?: boolean;
}

/** Refreshes Product-owned caches plus all public Search projections derived from Product state. */
export async function invalidateProductCommerceState(
  queryClient: QueryClient,
  options: ProductCommerceInvalidationOptions = {},
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: productQueryKeys.seller }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.public }),
    queryClient.invalidateQueries({ queryKey: searchDiscoveryQueryKeys.all }),
    ...(options.includeAdmin
      ? [queryClient.invalidateQueries({ queryKey: productQueryKeys.admin })]
      : []),
  ]);
}

/** Refreshes seller Inventory plus public Product/Search availability after a stock mutation. */
export async function invalidateInventoryCommerceState(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.seller }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.public }),
    queryClient.invalidateQueries({ queryKey: searchDiscoveryQueryKeys.all }),
  ]);
}

/** Refreshes private/public Store state and public Store Search after Store data changes. */
export async function invalidateStoreCommerceState(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller }),
    queryClient.invalidateQueries({ queryKey: sellerQueryKeys.publicStores }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.public }),
    queryClient.invalidateQueries({ queryKey: searchDiscoveryQueryKeys.all }),
  ]);
}

/** Refreshes every public commerce projection affected when a seller is suspended. */
export async function invalidateSellerLifecycleCommerceState(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sellerQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.public }),
    queryClient.invalidateQueries({ queryKey: searchDiscoveryQueryKeys.all }),
  ]);
}

/** Refreshes Review pages and all public rating projections after publication/rating changes. */
export async function invalidateRatingCommerceState(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.public }),
    queryClient.invalidateQueries({ queryKey: sellerQueryKeys.publicStores }),
    queryClient.invalidateQueries({ queryKey: searchDiscoveryQueryKeys.all }),
  ]);
}
