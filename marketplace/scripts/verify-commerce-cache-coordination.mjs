import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`Required cache-coordination file is missing: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`${label} is missing required cache marker: ${expected}`);
}

const helper = read("frontend/src/lib/commerce-cache-invalidation.ts");
for (const marker of [
  "invalidateProductCommerceState",
  "invalidateInventoryCommerceState",
  "invalidateStoreCommerceState",
  "invalidateSellerLifecycleCommerceState",
  "invalidateRatingCommerceState",
  "productQueryKeys.public",
  "inventoryQueryKeys.seller",
  "sellerQueryKeys.publicStores",
  "reviewsQueryKeys.all",
  "searchDiscoveryQueryKeys.all",
]) requireText(helper, marker, "Commerce cache invalidation helper");

const products = read("frontend/src/features/products/hooks/use-products.ts");
requireText(products, 'import { invalidateProductCommerceState } from "@/lib/commerce-cache-invalidation";', "Product hooks");
requireText(products, "await invalidateProductCommerceState(queryClient);", "Product hooks");
requireText(products, "await invalidateProductCommerceState(queryClient, { includeAdmin: true });", "Product hooks");

const inventory = read("frontend/src/features/inventory/hooks/use-inventory.ts");
requireText(inventory, "invalidateInventoryCommerceState(queryClient)", "Inventory hooks");

const sellers = read("frontend/src/features/sellers/hooks/use-sellers.ts");
if ((sellers.match(/invalidateStoreCommerceState\(queryClient\)/gu) ?? []).length < 2) {
  throw new Error("Store create/update mutations must both invalidate public Store/Product/Search projections.");
}
requireText(
  sellers,
  "invalidateSellerLifecycleCommerceState(queryClient)",
  "Seller suspension mutation",
);

const reviews = read("frontend/src/features/reviews/hooks/use-reviews.ts");
if ((reviews.match(/invalidateRatingCommerceState\(queryClient\)/gu) ?? []).length !== 4) {
  throw new Error("Review create/update/hide/publish mutations must invalidate public rating projections.");
}
requireText(
  reviews,
  "onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all })",
  "Helpful-vote mutation",
);

console.log("Cross-feature commerce cache coordination verification passed.");
