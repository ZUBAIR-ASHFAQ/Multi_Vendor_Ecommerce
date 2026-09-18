import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormError, firstFieldError } from "@/features/auth/components/form-error";
import type { CustomerAddress } from "@/features/customers/types/customers.types";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { useCheckoutShippingOptionsQuery } from "../hooks/use-checkout";
import {
  checkoutQuoteFormSchema,
  type CheckoutQuoteFormValues,
} from "../schemas/checkout.schemas";
import type { CreateCheckoutQuoteInput } from "../types/checkout.types";

/** Returns a compact readable label for one saved customer address. */
function addressLabel(address: CustomerAddress): string {
  return `${address.label} · ${address.line1}, ${address.city}, ${address.countryCode}`;
}

/** Returns the saved default address ID or a sensible first active fallback. */
function defaultAddressId(
  addresses: CustomerAddress[],
  kind: "shipping" | "billing",
): string {
  const preferred = addresses.find((address) =>
    kind === "shipping" ? address.isDefaultShipping : address.isDefaultBilling,
  );
  return preferred?.id ?? addresses[0]?.id ?? "";
}

/** Builds a new shipping-selection array after one store choice changes. */
function replaceShippingSelection(
  current: CheckoutQuoteFormValues["shippingSelections"],
  storeId: string,
  shippingMethodId: string,
): CheckoutQuoteFormValues["shippingSelections"] {
  const withoutStore = current.filter((selection) => selection.storeId !== storeId);
  if (!shippingMethodId) return withoutStore;
  return [...withoutStore, { storeId, shippingMethodId }];
}

/** Collects addresses, coupon, and one Shipping Core method per server-derived store using TanStack Form + Zod. */
export function CheckoutQuoteForm({
  addresses,
  isPending,
  error,
  onSubmit,
}: {
  addresses: CustomerAddress[];
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateCheckoutQuoteInput) => Promise<void>;
}) {
  const initialShippingAddressId = defaultAddressId(addresses, "shipping");
  const initialBillingAddressId = defaultAddressId(addresses, "billing");
  const [shippingAddressId, setShippingAddressId] = useState(initialShippingAddressId);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const shippingOptions = useCheckoutShippingOptionsQuery(
    shippingAddressId,
    shippingAddressId.length > 0,
  );

  const form = useForm({
    defaultValues: {
      shippingAddressId: initialShippingAddressId,
      billingAddressId: initialBillingAddressId,
      couponCode: "",
      shippingSelections: [],
    } satisfies CheckoutQuoteFormValues,
    validators: { onChange: checkoutQuoteFormSchema },
    onSubmit: async ({ value }) => {
      const expectedSelections = shippingOptions.data?.groups.length ?? 0;
      if (expectedSelections === 0 || value.shippingSelections.length !== expectedSelections) {
        setSelectionMessage("Choose one available shipping method for every seller/store group.");
        return;
      }

      setSelectionMessage(null);
      const normalizedCoupon = value.couponCode.trim().toUpperCase();
      const input: CreateCheckoutQuoteInput = {
        shippingAddressId: value.shippingAddressId,
        ...(value.billingAddressId ? { billingAddressId: value.billingAddressId } : {}),
        ...(normalizedCoupon ? { couponCode: normalizedCoupon } : {}),
        shippingSelections: value.shippingSelections,
      };

      try {
        await onSubmit(input);
      } catch {
        // TanStack Query owns the normalized request error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-5 rounded-xl border bg-white p-5 shadow-sm"
      aria-label="Checkout selections"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step 1–2</p>
        <h2 className="mt-1 text-xl font-bold">Address and shipping</h2>
        <p className="mt-1 text-sm text-slate-600">
          The server will reload Cart, Product, Inventory, Promotion, Shipping, address, and tax data before returning totals.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form.Field name="shippingAddressId">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Shipping address
                <select
                  aria-label="Shipping address"
                  className="mt-1 w-full rounded-md border bg-white px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const addressId = event.target.value;
                    field.handleChange(addressId);
                    form.setFieldValue("shippingSelections", []);
                    setShippingAddressId(addressId);
                    setSelectionMessage(null);
                  }}
                  aria-invalid={Boolean(fieldError)}
                >
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>{addressLabel(address)}</option>
                  ))}
                </select>
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="billingAddressId">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Billing address
                <select
                  aria-label="Billing address"
                  className="mt-1 w-full rounded-md border bg-white px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={Boolean(fieldError)}
                >
                  <option value="">Same as shipping address</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>{addressLabel(address)}</option>
                  ))}
                </select>
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>

      <form.Field name="couponCode">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Coupon code (optional)
              <input
                aria-label="Checkout coupon code"
                className="mt-1 w-full rounded-md border px-3 py-2 uppercase md:max-w-sm"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="SAVE10"
                aria-invalid={Boolean(fieldError)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      {shippingOptions.isPending ? <LoadingState label="Loading shipping methods..." /> : null}
      {shippingOptions.isError ? (
        <ErrorState
          title="Shipping options could not be loaded"
          message={shippingOptions.error instanceof Error ? shippingOptions.error.message : "Please try again."}
          requestId={shippingOptions.error instanceof ApiClientError ? shippingOptions.error.requestId : undefined}
          onRetry={() => void shippingOptions.refetch()}
        />
      ) : null}

      {shippingOptions.data ? (
        <form.Field name="shippingSelections">
          {(field) => (
            <section className="space-y-3" aria-label="Seller shipment groups">
              <div>
                <h3 className="font-semibold">Seller shipment groups</h3>
                <p className="text-sm text-slate-600">Choose one current server-provided Shipping Core method for every store.</p>
              </div>
              {shippingOptions.data.groups.length === 0 ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  No eligible shipping methods are available for this Cart and address.
                </p>
              ) : null}
              {shippingOptions.data.groups.map((group) => {
                const selected = field.state.value.find((selection) => selection.storeId === group.storeId)?.shippingMethodId ?? "";
                return (
                  <label key={group.storeId} className="block rounded-lg border p-3 text-sm font-medium">
                    Store {group.storeId.slice(0, 8)}
                    <select
                      aria-label={`Shipping method for store ${group.storeId.slice(0, 8)}`}
                      className="mt-2 w-full rounded-md border bg-white px-3 py-2"
                      value={selected}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(replaceShippingSelection(field.state.value, group.storeId, event.target.value));
                        setSelectionMessage(null);
                      }}
                    >
                      <option value="">Choose shipping method</option>
                      {group.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} · {formatMoney(option.rate, option.currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </section>
          )}
        </form.Field>
      ) : null}

      {selectionMessage ? <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">{selectionMessage}</p> : null}
      <FormError error={error} />
      <Button type="submit" disabled={isPending || shippingOptions.isPending || shippingOptions.isError}>
        {isPending ? "Calculating..." : "Calculate authoritative quote"}
      </Button>
    </form>
  );
}
