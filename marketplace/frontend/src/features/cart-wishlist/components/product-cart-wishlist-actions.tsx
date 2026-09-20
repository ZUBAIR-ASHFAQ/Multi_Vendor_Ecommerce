import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { CartQuantityForm } from "../forms/cart-quantity.form";
import {
  useAddCartItemMutation,
  useAddWishlistItemMutation,
} from "../hooks/use-cart-wishlist";

/** Renders Cart/Wishlist actions for one public Product variant without trusting storefront state as checkout truth. */
export function ProductCartWishlistActions({
  productId,
  variantId,
}: {
  productId: string;
  variantId: string;
}) {
  const addCart = useAddCartItemMutation();
  const addWishlist = useAddWishlistItemMutation();

  /** Adds the selected public variant to the authenticated customer's Cart. */
  async function addToCart(quantity: number): Promise<void> {
    await addCart.mutateAsync({ variantId, quantity });
  }

  /** Saves the selected variant to the default Wishlist so it can later move to Cart directly. */
  function saveToWishlist(): void {
    addWishlist.mutate({ productId, variantId });
  }

  const authRequired = [addCart.error, addWishlist.error].some(
    (error) => error instanceof ApiClientError && error.status === 401,
  );

  return (
    <div className="product-detail-cart-actions">
      <CartQuantityForm
        initialQuantity={1}
        submitLabel="Add to Cart"
        isPending={addCart.isPending}
        error={addCart.error}
        compact
        onSubmit={addToCart}
      />
      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={addWishlist.isPending}
          onClick={saveToWishlist}
        >
          {addWishlist.isPending ? "Saving..." : "Save to Wishlist"}
        </Button>
        <FormError error={addWishlist.error} />
        {authRequired ? (
          <p className="text-sm text-slate-600">
            <Link to="/login" className="font-medium underline">
              Sign in
            </Link>{" "}
            with a customer account to use Cart and Wishlist.
          </p>
        ) : null}
      </div>
    </div>
  );
}
