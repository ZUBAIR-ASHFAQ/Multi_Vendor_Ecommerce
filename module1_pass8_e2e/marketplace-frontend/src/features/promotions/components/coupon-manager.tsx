import { Button } from "@/components/ui/button";
import { COUPON_STATUS } from "../promotions.constants";
import type { PromotionCouponForm } from "../schemas/promotions.schemas";

/** Creates a blank coupon form value when an editor chooses to attach one. */
function emptyCoupon(): PromotionCouponForm {
  return {
    code: "",
    maxUses: "",
    maxUsesPerCustomer: "",
    status: COUPON_STATUS.ACTIVE,
  };
}

/** Edits the optional coupon attached to one promotion without adding generic coupon CRUD. */
export function CouponManager({
  value,
  onChange,
  allowRemove,
  showStatus,
}: {
  value: PromotionCouponForm | null;
  onChange: (value: PromotionCouponForm | null) => void;
  allowRemove: boolean;
  showStatus: boolean;
}) {
  if (!value) {
    return (
      <section className="rounded-lg border p-4">
        <h3 className="font-semibold">Coupon manager</h3>
        <p className="mt-1 text-sm text-slate-600">Attach one optional coupon code and usage limits to this promotion.</p>
        <Button className="mt-3" type="button" variant="outline" onClick={() => onChange(emptyCoupon())}>
          Attach coupon
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Coupon manager</h3>
          <p className="text-sm text-slate-600">Codes are normalized to uppercase by the API.</p>
        </div>
        {allowRemove ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove coupon
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Coupon code
          <input
            aria-label="Coupon code"
            className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
            value={value.code}
            onChange={(event) => onChange({ ...value, code: event.target.value.toUpperCase() })}
          />
        </label>

        {showStatus ? (
          <label className="text-sm font-medium">
            Coupon status
            <select
              aria-label="Coupon status"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={value.status}
              onChange={(event) => onChange({ ...value, status: event.target.value as PromotionCouponForm["status"] })}
            >
              <option value={COUPON_STATUS.ACTIVE}>Active</option>
              <option value={COUPON_STATUS.INACTIVE}>Inactive</option>
            </select>
          </label>
        ) : null}

        <label className="text-sm font-medium">
          Maximum total uses
          <input
            aria-label="Coupon maximum uses"
            inputMode="numeric"
            className="mt-1 w-full rounded-md border px-3 py-2"
            placeholder="Unlimited"
            value={value.maxUses}
            onChange={(event) => onChange({ ...value, maxUses: event.target.value })}
          />
        </label>

        <label className="text-sm font-medium">
          Maximum uses per customer
          <input
            aria-label="Coupon maximum uses per customer"
            inputMode="numeric"
            className="mt-1 w-full rounded-md border px-3 py-2"
            placeholder="Unlimited"
            value={value.maxUsesPerCustomer}
            onChange={(event) => onChange({ ...value, maxUsesPerCustomer: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
}
