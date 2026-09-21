import type { Cart } from "@/features/cart-wishlist/types/cart-wishlist.types";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { formatMoney } from "@/lib/money";
import type { CheckoutQuote } from "../types/checkout.types";

/** Display-only Product details carried from the public PDP for one direct Buy Now Checkout. */
export interface CheckoutBuyNowSummaryItem {
  variantId: string;
  productName: string;
  storeId: string;
  storeName: string;
  variantTitle: string | null;
  thumbnailFileId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

/** Renders a persistent Cart or direct Buy Now summary before and after authoritative quote calculation. */
export function CheckoutQuoteSummary({
  quote,
  cart,
  buyNowItem,
}: {
  quote: CheckoutQuote | null;
  cart: Cart | null;
  buyNowItem?: CheckoutBuyNowSummaryItem;
}) {
  const displayItems = buyNowItem
    ? [
        {
          key: `buy-now:${buyNowItem.variantId}`,
          variantId: buyNowItem.variantId,
          productName: buyNowItem.productName,
          storeId: buyNowItem.storeId,
          storeName: buyNowItem.storeName,
          variantTitle: buyNowItem.variantTitle,
          thumbnailFileId: buyNowItem.thumbnailFileId,
          quantity: buyNowItem.quantity,
          currency: buyNowItem.currency,
          previewLineSubtotal: null,
          unitPrice: buyNowItem.unitPrice,
        },
      ]
    : (cart?.items ?? []).map((item) => ({
        key: item.id,
        variantId: item.variantId,
        productName: item.productName ?? "Product",
        storeId: item.storeId ?? "",
        storeName: item.storeName ?? "Marketplace seller",
        variantTitle: item.variantTitle,
        thumbnailFileId: item.thumbnailFileId,
        quantity: item.quantity,
        currency: item.currency,
        previewLineSubtotal: item.previewLineSubtotal,
        unitPrice: item.currentUnitPrice,
      }));
  const media = usePublicMediaQuery(displayItems.map((item) => item.thumbnailFileId));
  const mediaById = new Map((media.data?.items ?? []).map((item) => [item.fileId, item]));
  const totalQuantity = displayItems.reduce((total, item) => total + item.quantity, 0);
  const displayCurrency = quote?.currency ?? buyNowItem?.currency ?? cart?.currency ?? "USD";

  return (
    <aside
      className="checkout-order-summary"
      aria-label={quote ? "Checkout quote summary" : "Order summary"}
    >
      <div className="checkout-order-summary-heading">
        <div>
          <p>{quote ? "Final review" : buyNowItem ? "Buy now" : "Your order"}</p>
          <h2>Order summary</h2>
        </div>
        <span>{totalQuantity} {totalQuantity === 1 ? "item" : "items"}</span>
      </div>

      <div className="checkout-summary-items">
        {displayItems.map((item) => {
          const resolved = item.thumbnailFileId ? mediaById.get(item.thumbnailFileId) : undefined;
          const line = quote?.lines.find((candidate) => candidate.variantId === item.variantId) ?? null;
          const itemTotal = line?.lineTotal ?? item.previewLineSubtotal;
          return (
            <article key={item.key} className="checkout-summary-item">
              <div className="checkout-summary-media" aria-hidden="true">
                {resolved?.url && resolved.mimeType.startsWith("image/") ? (
                  <img src={resolved.url} alt="" />
                ) : (
                  <span>{item.productName.slice(0, 1).toUpperCase() || "P"}</span>
                )}
              </div>
              <div className="checkout-summary-copy">
                <strong>{item.productName}</strong>
                <span>{item.storeName}</span>
                <small>{item.variantTitle ? `${item.variantTitle} · ` : ""}Qty {item.quantity}</small>
              </div>
              <strong className="checkout-summary-item-total">
                {itemTotal
                  ? formatMoney(itemTotal, displayCurrency)
                  : item.unitPrice
                    ? `${formatMoney(item.unitPrice, item.currency)} each`
                    : "—"}
              </strong>
            </article>
          );
        })}
      </div>

      <dl className="checkout-summary-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>
            {quote
              ? formatMoney(quote.subtotal, quote.currency)
              : cart
                ? formatMoney(cart.previewSubtotal, cart.currency)
                : "Calculated next"}
          </dd>
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
            const matchingItem = displayItems.find((item) => item.storeId === selection.storeId);
            const storeName = matchingItem?.storeName ?? `Store ${selection.storeId.slice(0, 8)}`;
            return (
              <div key={selection.storeId}>
                <span>{storeName}</span>
                <small>{selection.shippingMethodName}</small>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="checkout-summary-note">
        {quote
          ? "Totals are locked to this short-lived review. Recalculate if your order details change."
          : buyNowItem
            ? "Buy Now does not change your Cart. Final pricing, stock, promotions, delivery and tax are checked before you place the order."
            : "Your cart subtotal is a preview. Final pricing, stock, promotions, delivery and tax are checked before you place the order."}
      </p>
    </aside>
  );
}
