import type { Cart } from "@/features/cart-wishlist/types/cart-wishlist.types";
import { formatMoney } from "@/lib/money";
import type { CheckoutQuote } from "../types/checkout.types";

/** Returns a readable Cart label for one quoted variant without changing the immutable quote itself. */
function lineLabel(variantId: string, cart: Cart): string {
  const item = cart.items.find((candidate) => candidate.variantId === variantId);
  if (!item) return `Variant ${variantId.slice(0, 8)}`;
  return item.variantTitle ? `${item.productName ?? "Product"} · ${item.variantTitle}` : item.productName ?? "Product";
}

/** Renders the server-authoritative quote totals, lines, coupon, and Shipping Core snapshots. */
export function CheckoutQuoteSummary({ quote, cart }: { quote: CheckoutQuote; cart: Cart }) {
  return (
    <section className="space-y-5 rounded-xl border bg-white p-5 shadow-sm" aria-label="Checkout quote summary">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Authoritative quote</p>
        <h2 className="mt-1 text-xl font-bold">Review totals</h2>
        <p className="mt-1 text-sm text-slate-600">
          These amounts were recalculated by the server from current Product, Inventory, Promotion, Shipping, address, and tax data.
        </p>
      </div>

      <div className="space-y-3">
        {quote.lines.map((line) => (
          <div key={line.variantId} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-semibold">{lineLabel(line.variantId, cart)}</p>
                <p className="text-slate-500">Qty {line.quantity} · Store {line.storeId.slice(0, 8)}</p>
              </div>
              <p className="font-semibold">{formatMoney(line.lineTotal, quote.currency)}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Unit {formatMoney(line.unitPrice, quote.currency)} · Discount {formatMoney(line.discount, quote.currency)} ·
              Tax {formatMoney(line.tax, quote.currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-4"><span>Subtotal</span><span>{formatMoney(quote.subtotal, quote.currency)}</span></div>
        <div className="flex justify-between gap-4">
          <span>Discount{quote.couponCode ? ` (${quote.couponCode})` : ""}</span>
          <span>-{formatMoney(quote.discountTotal, quote.currency)}</span>
        </div>
        <div className="flex justify-between gap-4"><span>Tax</span><span>{formatMoney(quote.taxTotal, quote.currency)}</span></div>
        <div className="flex justify-between gap-4">
          <span>Shipping</span>
          <span>{formatMoney(quote.shippingTotal, quote.currency)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-3 text-base font-bold">
          <span>Grand total</span>
          <span>{formatMoney(quote.grandTotal, quote.currency)}</span>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-semibold">Seller shipment groups</h3>
        <div className="mt-2 space-y-2 text-sm">
          {quote.shippingSelections.map((selection) => (
            <div key={selection.storeId} className="flex flex-wrap justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
              <span>Store {selection.storeId.slice(0, 8)} · {selection.shippingMethodName}</span>
              <span>{formatMoney(selection.amount, selection.currency)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
