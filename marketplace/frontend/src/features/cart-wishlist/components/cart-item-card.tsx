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
export function CartItemCard({
  item,
  imageUrl,
  imageMimeType,
}: {
  item: CartItem;
  imageUrl?: string;
  imageMimeType?: string;
}) {
  const update = useUpdateCartItemMutation(item.id);
  const remove = useRemoveCartItemMutation(item.id);
  const warning = availabilityMessage(item);
  const hasImage = Boolean(imageUrl && imageMimeType?.startsWith("image/"));

  /** Sends one validated quantity change to the customer-scoped Cart API. */
  async function updateQuantity(quantity: number): Promise<void> {
    await update.mutateAsync({ quantity });
  }

  return (
    <article className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-t border-slate-200 py-5 first:border-t-0 md:grid-cols-[104px_minmax(0,1fr)_180px]">
      <div className="overflow-hidden rounded-xl bg-slate-100">
        {item.productSlug ? (
          <Link
            to="/products/$slug"
            params={{ slug: item.productSlug }}
            className="block aspect-square"
            aria-label={`View ${item.productName ?? "Product"}`}
          >
            {hasImage ? (
              <img
                src={imageUrl}
                alt={item.productName ?? "Product"}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl text-slate-400" aria-hidden="true">
                ◇
              </span>
            )}
          </Link>
        ) : (
          <div className="flex aspect-square items-center justify-center text-2xl text-slate-400" aria-hidden="true">
            ◇
          </div>
        )}
      </div>

      <div className="min-w-0">
        {item.productSlug ? (
          <Link
            to="/products/$slug"
            params={{ slug: item.productSlug }}
            className="text-base font-bold text-slate-950 hover:underline"
          >
            {item.productName ?? "Product"}
          </Link>
        ) : (
          <h3 className="text-base font-bold text-slate-950">{item.productName ?? "Unavailable Product"}</h3>
        )}

        <p className="mt-1 text-sm text-slate-600">
          {item.variantTitle ?? "Variant unavailable"}
          {item.sku ? ` · SKU ${item.sku}` : ""}
        </p>

        {item.currentUnitPrice ? (
          <p className="mt-3 text-sm text-slate-600">
            {formatMoney(item.currentUnitPrice, item.currency)} each
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Current price is unavailable.</p>
        )}

        {item.previewLineSubtotal ? (
          <p className="mt-1 text-base font-bold text-slate-950">
            {formatMoney(item.previewLineSubtotal, item.currency)}
          </p>
        ) : null}

        {warning ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warning}
          </p>
        ) : null}
      </div>

      <div className="col-span-2 space-y-3 md:col-span-1">
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
          className="w-full"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? "Removing..." : "Remove"}
        </Button>
      </div>
    </article>
  );
}
