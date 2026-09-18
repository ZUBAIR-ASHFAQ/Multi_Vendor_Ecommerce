import { Link } from "@tanstack/react-router";
import { formatMoney } from "@/lib/money";
import { useCartQuery } from "../hooks/use-cart-wishlist";

/** Shows a compact Cart summary without treating the preview subtotal as a final checkout total. */
export function MiniCart({ load = true }: { load?: boolean }) {
  const cart = useCartQuery(load);

  if (!load && !cart.data) {
    return (
      <Link to="/cart" className="rounded-md px-3 py-2 text-sm hover:bg-slate-50">
        Cart
      </Link>
    );
  }

  if (cart.isPending) {
    return <span className="text-sm text-slate-500">Loading Cart...</span>;
  }

  if (cart.isError) {
    return (
      <Link to="/cart" className="text-sm font-medium text-slate-700 hover:underline">
        Cart
      </Link>
    );
  }

  const totalQuantity = cart.data.items.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const itemLabel = totalQuantity === 1 ? "item" : "items";

  return (
    <Link
      to="/cart"
      className="rounded-lg border bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
      aria-label={`Mini Cart with ${totalQuantity} ${itemLabel}`}
    >
      <span className="font-semibold">Cart · {totalQuantity}</span>
      <span className="ml-2 text-xs text-slate-500">
        {formatMoney(cart.data.previewSubtotal, cart.data.currency)} preview
      </span>
    </Link>
  );
}
