import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { PAYMENT_STATUS } from "../payments.constants";
import { adminPaymentFilterSchema } from "../schemas/payments.schemas";
import type { AdminPaymentsParams } from "../types/payments.types";

/** Collects only allow-listed finance Payment search filters and validates real user input with Zod. */
export function AdminPaymentFilterForm({
  onApply,
}: {
  onApply: (filters: Partial<AdminPaymentsParams>) => void;
}) {
  const form = useForm({
    defaultValues: {
      status: "",
      orderId: "",
      providerPaymentId: "",
      currency: "",
    },
    validators: { onChange: adminPaymentFilterSchema },
    onSubmit: ({ value }) => {
      const parsed = adminPaymentFilterSchema.parse(value);
      onApply({
        status: parsed.status || undefined,
        orderId: parsed.orderId || undefined,
        providerPaymentId: parsed.providerPaymentId || undefined,
        currency: parsed.currency || undefined,
      });
    },
  });

  return (
    <form
      className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="status">
        {(field) => (
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Payment status filter"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Any</option>
              <option value={PAYMENT_STATUS.PENDING}>Pending</option>
              <option value={PAYMENT_STATUS.PROCESSING}>Processing</option>
              <option value={PAYMENT_STATUS.CAPTURED}>Captured</option>
              <option value={PAYMENT_STATUS.FAILED}>Failed</option>
              <option value={PAYMENT_STATUS.CANCELLED}>Cancelled</option>
              <option value={PAYMENT_STATUS.PARTIALLY_REFUNDED}>Partially refunded</option>
              <option value={PAYMENT_STATUS.REFUNDED}>Refunded</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="orderId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Order UUID
              <input
                aria-label="Payment Order UUID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="providerPaymentId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Stripe PaymentIntent
              <input
                aria-label="Stripe PaymentIntent filter"
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="pi_..."
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="currency">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Currency
              <input
                aria-label="Payment currency filter"
                className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                placeholder="USD"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                aria-invalid={Boolean(error)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <div className="flex items-end">
        <Button className="w-full">Apply filters</Button>
      </div>
    </form>
  );
}
