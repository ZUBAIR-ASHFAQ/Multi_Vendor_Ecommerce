import type { Cart, CartItem } from "@/features/cart-wishlist/types/cart-wishlist.types";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { formatMoney } from "@/lib/money";
import type { CheckoutQuote } from "../types/checkout.types";

/** Finds the authoritative line for one Cart item when a quote has already been calculated. */
function quoteLineFor(item: CartItem, quote: CheckoutQuote | null) {
  return quote?.lines.find((line) => line.variantId === item.variantId) ?? null;
}

/** Renders a persistent Cart/order summary before and after authoritative quote calculation. */
export function CheckoutQuoteSummary({ quote, cart }: { quote: CheckoutQuote | null; cart: Cart }) {
  const media = usePublicMediaQuery(cart.items.map((item) => item.thumbnailFileId));
  const mediaById = new Map((media.data?.items ?? []).map((item) => [item.fileId, item]));
  const totalQuantity = cart.items.reduce((total, item) => total + item.quantity, 0);

  return (
    <aside
      className="checkout-order-summary"
      aria-label={quote ? "Checkout quote summary" : "Order summary"}
    >
      <div className="checkout-order-summary-heading">
        <div>
          <p>{quote ? "Final review" : "Your order"}</p>
          <h2>Order summary</h2>
        </div>
        <span>{totalQuantity} {totalQuantity === 1 ? "item" : "items"}</span>
      </div>

      <div className="checkout-summary-items">
        {cart.items.map((item) => {
          const resolved = item.thumbnailFileId ? mediaById.get(item.thumbnailFileId) : undefined;
          const line = quoteLineFor(item, quote);
          const itemTotal = line?.lineTotal ?? item.previewLineSubtotal;
          return (
            <article key={item.id} className="checkout-summary-item">
              <div className="checkout-summary-media" aria-hidden="true">
                {resolved?.url && resolved.mimeType.startsWith("image/") ? (
                  <img src={resolved.url} alt="" />
                ) : (
                  <span>{item.productName?.slice(0, 1).toUpperCase() || "P"}</span>
                )}
              </div>
              <div className="checkout-summary-copy">
                <strong>{item.productName ?? "Product"}</strong>
                <span>{item.storeName ?? "Marketplace seller"}</span>
                <small>{item.variantTitle ? `${item.variantTitle} · ` : ""}Qty {item.quantity}</small>
              </div>
              <strong className="checkout-summary-item-total">
                {itemTotal ? formatMoney(itemTotal, quote?.currency ?? item.currency) : "—"}
              </strong>
            </article>
          );
        })}
      </div>

      <dl className="checkout-summary-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMoney(quote?.subtotal ?? cart.previewSubtotal, quote?.currency ?? cart.currency)}</dd>
        </div>
        {quote ? (
          <>
            <div>
              <dt>Discount{quote.couponCode ? ` (${quote.couponCode})` : ""}</dt>
              <dd>-{formatMoney(quote.discountTotal, quote.currency)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{formatMoney(quote.shippingTotal, quote.currency)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(quote.taxTotal, quote.currency)}</dd>
            </div>
            <div className="checkout-summary-grand-total">
              <dt>Total</dt>
              <dd>{formatMoney(quote.grandTotal, quote.currency)}</dd>
            </div>
          </>
        ) : (
          <div className="checkout-summary-pending-total">
            <dt>Delivery &amp; tax</dt>
            <dd>Calculated next</dd>
          </div>
        )}
      </dl>

      {quote ? (
        <div className="checkout-summary-delivery">
          <h3>Delivery</h3>
          {quote.shippingSelections.map((selection) => {
            const matchingItem = cart.items.find((item) => item.storeId === selection.storeId);
            return (
              <div key={selection.storeId}>
                <span>{matchingItem?.storeName ?? `Store ${selection.storeId.slice(0, 8)}`}</span>
                <small>{selection.shippingMethodName}</small>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="checkout-summary-note">
        {quote
          ? "Totals are locked to this short-lived review. Recalculate if your order details change."
          : "Your cart subtotal is a preview. Final pricing, stock, promotions, delivery and tax are checked before you place the order."}
      </p>
    </aside>
  );
}
