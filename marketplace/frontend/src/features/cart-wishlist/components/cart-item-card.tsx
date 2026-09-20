import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { formatMoney } from "@/lib/money";
import { CartQuantityForm } from "../forms/cart-quantity.form";
import {
  useRemoveCartItemMutation,
  useUpdateCartItemMutation,
} from "../hooks/use-cart-wishlist";
import type { CartItem } from "../types/cart-wishlist.types";

/** Builds a short customer-facing warning from the current Product and Inventory display state. */
function availabilityMessage(item: CartItem): string | null {
  if (!item.isPurchasable) return "This Product or variant is no longer available for purchase.";
  if (!item.inStock) return "This variant is currently out of stock.";
  return null;
}

/** Renders one Cart line with current price/availability and explicit quantity/remove commands. */
export function CartItemCard({ item }: { item: CartItem }) {
  const update = useUpdateCartItemMutation(item.id);
  const remove = useRemoveCartItemMutation(item.id);
  const warning = availabilityMessage(item);

  /** Sends one validated quantity change to the customer-scoped Cart API. */
  async function updateQuantity(quantity: number): Promise<void> {
    await update.mutateAsync({ quantity });
  }

  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {item.productSlug ? (
            <Link
              to="/products/$slug"
              params={{ slug: item.productSlug }}
              className="text-lg font-bold hover:underline"
            >
              {item.productName ?? "Product"}
            </Link>
          ) : (
            <h2 className="text-lg font-bold">{item.productName ?? "Unavailable Product"}</h2>
          )}
          <p className="mt-1 text-sm text-slate-600">
            {item.variantTitle ?? "Variant unavailable"}
            {item.sku ? ` · SKU ${item.sku}` : ""}
          </p>
          {item.currentUnitPrice ? (
            <p className="mt-2 text-sm">
              Current unit price: {formatMoney(item.currentUnitPrice, item.currency)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Current price is unavailable.</p>
          )}
          {item.previewLineSubtotal ? (
            <p className="text-sm font-semibold">
              Line preview: {formatMoney(item.previewLineSubtotal, item.currency)}
            </p>
          ) : null}
          {warning ? (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {warning}
            </p>
          ) : null}
        </div>

        <div className="min-w-44 space-y-3">
          <CartQuantityForm
            initialQuantity={item.quantity}
            submitLabel="Update quantity"
            isPending={update.isPending}
            error={update.error}
            compact
            onSubmit={updateQuantity}
          />
          <FormError error={remove.error} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing..." : "Remove"}
          </Button>
        </div>
      </div>
    </article>
  );
}
