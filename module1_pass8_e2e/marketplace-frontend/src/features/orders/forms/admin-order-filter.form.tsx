import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { adminOrdersFilterSchema } from "../schemas/orders.schemas";
import type { AdminOrdersParams } from "../types/orders.types";

/** Collects only allow-listed Module 11 admin Order search filters. */
export function AdminOrderFilterForm({
  onApply,
}: {
  onApply: (filters: Partial<AdminOrdersParams>) => void;
}) {
  const form = useForm({
    defaultValues: {
      orderNo: "",
      customerUserId: "",
      orderStatus: "",
      paymentStatus: "",
    },
    validators: { onChange: adminOrdersFilterSchema },
    onSubmit: ({ value }) => {
      const parsed = adminOrdersFilterSchema.parse(value);
      onApply({
        orderNo: parsed.orderNo || undefined,
        customerUserId: parsed.customerUserId || undefined,
        orderStatus: parsed.orderStatus || undefined,
        paymentStatus: parsed.paymentStatus || undefined,
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
      <form.Field name="orderNo">
        {(field) => (
          <label className="text-sm font-medium">
            Order number
            <input
              aria-label="Order number"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <form.Field name="customerUserId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Customer UUID
              <input
                aria-label="Customer UUID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? (
                <span className="mt-1 block text-xs text-red-600">{error}</span>
              ) : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="orderStatus">
        {(field) => (
          <label className="text-sm font-medium">
            Order status
            <select
              aria-label="Order status"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Any</option>
              <option value="pending_payment">Pending payment</option>
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="paymentStatus">
        {(field) => (
          <label className="text-sm font-medium">
            Payment
            <select
              aria-label="Payment"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Any</option>
              <option value="pending">Pending</option>
              <option value="captured">Captured</option>
            </select>
          </label>
        )}
      </form.Field>

      <div className="flex items-end">
        <Button className="w-full">Apply filters</Button>
      </div>
    </form>
  );
}
