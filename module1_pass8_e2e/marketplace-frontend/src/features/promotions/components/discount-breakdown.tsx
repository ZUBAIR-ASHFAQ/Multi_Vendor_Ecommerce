import { formatMoney } from "@/lib/money";
import type { PromotionValidation } from "../schemas/promotions.schemas";

/** Renders the server-calculated coupon preview without treating it as a final Checkout total. */
export function DiscountBreakdown({ preview }: { preview: PromotionValidation }) {
  return (
    <section className="rounded-lg border bg-emerald-50 p-4" aria-label="Discount breakdown">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-950">Coupon {preview.code} is eligible</p>
          <p className="text-xs text-emerald-800">Funding: {preview.fundingType}</p>
        </div>
        <p className="text-lg font-bold text-emerald-950">
          -{formatMoney(preview.discountTotal, preview.currency)}
        </p>
      </div>

      {preview.allocations.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-emerald-900">
          {preview.allocations.map((allocation) => (
            <li key={allocation.cartItemId} className="flex justify-between gap-3">
              <span className="font-mono">Item {allocation.cartItemId.slice(0, 8)}…</span>
              <span>-{formatMoney(allocation.discountAmount, preview.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-emerald-900">
        Preview only. Checkout must revalidate promotion, Product, Inventory, shipping, tax, and final totals.
      </p>
    </section>
  );
}
