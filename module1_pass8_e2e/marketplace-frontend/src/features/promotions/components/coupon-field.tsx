import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormError, firstFieldError } from "@/features/auth/components/form-error";
import { useCurrentUserQuery } from "@/features/auth/hooks/use-auth";
import { PROMOTION_PERMISSION } from "../promotions.constants";
import { useValidateCouponMutation } from "../hooks/use-promotions";
import { DiscountBreakdown } from "./discount-breakdown";

const couponFieldSchema = z.object({
  code: z.string().trim().min(1, "Enter a coupon code.").max(120),
});

/** Lets a customer validate one coupon against the server-derived current Cart. */
export function CouponField() {
  const currentUser = useCurrentUserQuery();
  const validateCoupon = useValidateCouponMutation();
  const canValidate =
    currentUser.data?.accountType === "customer" &&
    currentUser.data.permissions.includes(PROMOTION_PERMISSION.READ);
  const form = useForm({
    defaultValues: { code: "" },
    validators: { onSubmit: couponFieldSchema },
    onSubmit: async ({ value }) => {
      const parsed = couponFieldSchema.parse(value);
      await validateCoupon.mutateAsync(parsed.code.trim().toUpperCase());
    },
  });

  if (currentUser.data && !canValidate) {
    return (
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Coupon</h2>
        <p className="mt-1 text-sm text-slate-500">Your account does not have permission to validate promotions.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="font-semibold">Coupon</h2>
        <p className="mt-1 text-sm text-slate-600">
          Validate a code against your current Cart. This is a preview; the later Checkout workflow remains authoritative.
        </p>
      </div>

      <form
        className="flex flex-wrap items-start gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="code">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="min-w-64 flex-1 text-sm font-medium">
                Coupon code
                <input
                  aria-label="Checkout coupon code"
                  aria-invalid={Boolean(error)}
                  className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toUpperCase());
                    validateCoupon.reset();
                  }}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
        <Button className="mt-6" disabled={!canValidate || validateCoupon.isPending}>
          {validateCoupon.isPending ? "Checking..." : "Apply coupon"}
        </Button>
      </form>

      <FormError error={validateCoupon.error} />
      {validateCoupon.data ? <DiscountBreakdown preview={validateCoupon.data} /> : null}
    </section>
  );
}
