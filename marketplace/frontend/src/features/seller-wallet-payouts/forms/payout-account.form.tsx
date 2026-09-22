import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { env } from "@/lib/env";
import { payoutAccountFormSchema } from "../schemas/seller-wallet-payouts.schemas";
import type { CreatePayoutAccountInput } from "../types/seller-wallet-payouts.types";

/** Adds only a provider-owned/tokenized reference; raw bank/card details never pass through this marketplace form. */
export function PayoutAccountForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreatePayoutAccountInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      providerType: env.VITE_LOCAL_DEMO_PROVIDERS ? "local_dev" : "",
      providerAccountRef: "",
    },
    validators: { onChange: payoutAccountFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = payoutAccountFormSchema.parse(value);
      try {
        await onSubmit(parsed);
        form.reset();
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="font-semibold">Payout account setup</h2>
        <p className="mt-1 text-xs text-slate-600">
          Enter a token/reference created by your configured payout provider. Do not enter raw bank account or card credentials here.
        </p>
        {env.VITE_LOCAL_DEMO_PROVIDERS ? (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Local demo provider is active. Keep provider type <strong>local_dev</strong> and use
            <code className="mx-1">paid:demo_account</code> for success,
            <code className="mx-1">failed:demo_account</code> for failure, or
            <code className="mx-1">unknown_then_paid:demo_account</code> to exercise reconciliation.
          </p>
        ) : null}
      </div>
      <form.Field name="providerType">
        {(field) => {
          const message = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Provider type
              <input
                aria-label="Payout provider type"
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder={env.VITE_LOCAL_DEMO_PROVIDERS ? "local_dev" : "configured_provider"}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toLowerCase())}
              />
              {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
            </label>
          );
        }}
      </form.Field>
      <form.Field name="providerAccountRef">
        {(field) => {
          const message = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Provider account/token reference
              <input
                aria-label="Provider account reference"
                className="mt-1 w-full rounded-md border px-3 py-2"
                autoComplete="off"
                placeholder={env.VITE_LOCAL_DEMO_PROVIDERS ? "paid:demo_account" : undefined}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
            </label>
          );
        }}
      </form.Field>
      <FormError error={error} />
      <Button type="submit" disabled={isPending}>{isPending ? "Validating account..." : "Add Payout Account"}</Button>
    </form>
  );
}
