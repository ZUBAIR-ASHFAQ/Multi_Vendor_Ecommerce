import { Link } from "@tanstack/react-router";
import { formatMoney } from "@/lib/money";
import { useCartQuery } from "../hooks/use-cart-wishlist";

/** Shows a compact Cart summary without treating the preview subtotal as a final checkout total. */
export function MiniCart({ load = true }: { load?: boolean }) {
  const cart = useCartQuery(load);

  if (!load && !cart.data) {
    return (
      <Link to="/cart" className="marketplace-cart-link">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 7H6m4 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm9 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" /></svg>
        <span>Cart</span>
      </Link>
    );
  }

  if (cart.isPending) {
    return <span className="marketplace-cart-link">Loading Cart…</span>;
  }

  if (cart.isError) {
    return <Link to="/cart" className="marketplace-cart-link">Cart</Link>;
  }

  const totalQuantity = cart.data.items.reduce((total, item) => total + item.quantity, 0);
  const itemLabel = totalQuantity === 1 ? "item" : "items";

  return (
    <Link
      to="/cart"
      className="marketplace-cart-link"
      aria-label={`Mini Cart with ${totalQuantity} ${itemLabel}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 7H6m4 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm9 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" /></svg>
      <span>Cart</span>
      <span className="marketplace-count-badge">{totalQuantity}</span>
      <span className="sr-only">{formatMoney(cart.data.previewSubtotal, cart.data.currency)} preview subtotal</span>
    </Link>
  );
}
