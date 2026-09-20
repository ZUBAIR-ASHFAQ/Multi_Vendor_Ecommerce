import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  normalizeScale4Money,
  payoutRequestFormSchema,
} from "../schemas/seller-wallet-payouts.schemas";
import type { PayoutAccount } from "../schemas/seller-wallet-payouts.schemas";
import type { RequestPayoutInput } from "../types/seller-wallet-payouts.types";

/** Collects only seller-entered amount/currency/account while leaving balances, seller identity, and status to the API. */
export function PayoutRequestForm({
  accounts,
  defaultCurrency,
  isPending,
  error,
  onSubmit,
}: {
  accounts: PayoutAccount[];
  defaultCurrency: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: RequestPayoutInput, idempotencyKey: string) => Promise<void>;
}) {
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.verifiedAt);
  const form = useForm({
    defaultValues: {
      accountId: activeAccounts[0]?.id ?? "",
      amount: "",
      currency: defaultCurrency,
    },
    validators: { onChange: payoutRequestFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = payoutRequestFormSchema.parse(value);
      const input: RequestPayoutInput = {
        accountId: parsed.accountId,
        amount: normalizeScale4Money(parsed.amount),
        currency: parsed.currency,
      };
      try {
        await onSubmit(input, crypto.randomUUID());
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  if (activeAccounts.length === 0) {
    return (
      <p className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
        Add an active verified payout account before requesting a Payout. Provider validation remains server-side.
      </p>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="font-semibold">Request payout</h2>
        <p className="mt-1 text-xs text-slate-600">The API verifies available balance and seller ownership before reserving anything.</p>
      </div>
      <form.Field name="accountId">
        {(field) => {
          const message = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Payout account
              <select
                aria-label="Payout account"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Choose an account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.providerType} · {account.maskedDetails}</option>
                ))}
              </select>
              {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
            </label>
          );
        }}
      </form.Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <form.Field name="amount">
          {(field) => {
            const message = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Amount
                <input
                  aria-label="Payout amount"
                  inputMode="decimal"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="100.0000"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
              </label>
            );
          }}
        </form.Field>
        <form.Field name="currency">
          {(field) => {
            const message = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Currency
                <input
                  aria-label="Payout currency"
                  className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                  maxLength={3}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                />
                {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>
      <FormError error={error} />
      <Button type="submit" disabled={isPending}>{isPending ? "Requesting payout..." : "Request Payout"}</Button>
    </form>
  );
}
