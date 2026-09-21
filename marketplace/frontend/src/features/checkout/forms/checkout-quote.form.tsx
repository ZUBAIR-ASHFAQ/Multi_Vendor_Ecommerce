import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError, firstFieldError } from "@/features/auth/components/form-error";
import type { CustomerAddress } from "@/features/customers/types/customers.types";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { useCheckoutShippingOptionsQuery } from "../hooks/use-checkout";
import {
  checkoutQuoteFormSchema,
  type CheckoutQuoteFormValues,
} from "../schemas/checkout.schemas";
import type { CheckoutBuyNowItemInput, CreateCheckoutQuoteInput } from "../types/checkout.types";

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

/** Collects saved addresses, coupon, and one server-provided delivery method per store. */
export function CheckoutQuoteForm({
  addresses,
  storeNamesById,
  isPending,
  error,
  onSubmit,
  buyNowItem,
}: {
  addresses: CustomerAddress[];
  storeNamesById: ReadonlyMap<string, string>;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateCheckoutQuoteInput) => Promise<void>;
  buyNowItem?: CheckoutBuyNowItemInput;
}) {
  const initialShippingAddressId = defaultAddressId(addresses, "shipping");
  const initialBillingAddressId = defaultAddressId(addresses, "billing");
  const [shippingAddressId, setShippingAddressId] = useState(initialShippingAddressId);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const shippingOptions = useCheckoutShippingOptionsQuery(
    shippingAddressId,
    shippingAddressId.length > 0,
    buyNowItem,
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
        setSelectionMessage("Choose one delivery method for every seller in your order.");
        return;
      }

      setSelectionMessage(null);
      const normalizedCoupon = value.couponCode.trim().toUpperCase();
      const input: CreateCheckoutQuoteInput = {
        shippingAddressId: value.shippingAddressId,
        ...(value.billingAddressId ? { billingAddressId: value.billingAddressId } : {}),
        ...(normalizedCoupon ? { couponCode: normalizedCoupon } : {}),
        shippingSelections: value.shippingSelections,
        ...(buyNowItem ? { buyNowItem } : {}),
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
      className="checkout-selection-card"
      aria-label="Checkout selections"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <section className="checkout-form-section" aria-labelledby="checkout-address-heading">
        <div className="checkout-section-heading">
          <div>
            <p>Step 1</p>
            <h2 id="checkout-address-heading">Delivery address</h2>
            <span>Choose where this order should be delivered and billed.</span>
          </div>
          <Link to="/customer/addresses">Manage addresses</Link>
        </div>

        <div className="checkout-address-grid">
          <form.Field name="shippingAddressId">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="checkout-field">
                  <span>Shipping address</span>
                  <Select
                    aria-label="Shipping address"
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
                  </Select>
                  {fieldError ? <small className="checkout-field-error">{fieldError}</small> : null}
                </label>
              );
            }}
          </form.Field>

          <form.Field name="billingAddressId">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="checkout-field">
                  <span>Billing address</span>
                  <Select
                    aria-label="Billing address"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={Boolean(fieldError)}
                  >
                    <option value="">Same as shipping address</option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>{addressLabel(address)}</option>
                    ))}
                  </Select>
                  {fieldError ? <small className="checkout-field-error">{fieldError}</small> : null}
                </label>
              );
            }}
          </form.Field>
        </div>
      </section>

      <section className="checkout-form-section" aria-labelledby="checkout-delivery-heading">
        <div className="checkout-section-heading">
          <div>
            <p>Step 2</p>
            <h2 id="checkout-delivery-heading">Delivery options</h2>
            <span>Choose one available method for each seller in your order.</span>
          </div>
        </div>

        {shippingOptions.isPending ? <LoadingState label="Loading delivery options..." /> : null}
        {shippingOptions.isError ? (
          <ErrorState
            title="Delivery options could not be loaded"
            message={shippingOptions.error instanceof Error ? shippingOptions.error.message : "Please try again."}
            requestId={shippingOptions.error instanceof ApiClientError ? shippingOptions.error.requestId : undefined}
            onRetry={() => void shippingOptions.refetch()}
          />
        ) : null}

        {shippingOptions.data ? (
          <form.Field name="shippingSelections">
            {(field) => (
              <div className="checkout-delivery-groups" aria-label="Seller shipment groups">
                {shippingOptions.data.groups.length === 0 ? (
                  <p className="checkout-inline-warning">
                    No delivery methods are available for this address. Try another saved address.
                  </p>
                ) : null}
                {shippingOptions.data.groups.map((group) => {
                  const selected = field.state.value.find((selection) => selection.storeId === group.storeId)?.shippingMethodId ?? "";
                  const storeName = storeNamesById.get(group.storeId) ?? `Store ${group.storeId.slice(0, 8)}`;
                  return (
                    <label key={group.storeId} className="checkout-delivery-group">
                      <span className="checkout-delivery-store">{storeName}</span>
                      <Select
                        aria-label={`Shipping method for ${storeName}`}
                        value={selected}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(replaceShippingSelection(field.state.value, group.storeId, event.target.value));
                          setSelectionMessage(null);
                        }}
                      >
                        <option value="">Choose delivery method</option>
                        {group.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} · {formatMoney(option.rate, option.currency)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  );
                })}
              </div>
            )}
          </form.Field>
        ) : null}
      </section>

      <section className="checkout-form-section checkout-promo-section" aria-labelledby="checkout-promo-heading">
        <div className="checkout-section-heading">
          <div>
            <p>Optional</p>
            <h2 id="checkout-promo-heading">Promo code</h2>
            <span>Eligible discounts are verified when your order is reviewed.</span>
          </div>
        </div>

        <form.Field name="couponCode">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="checkout-field checkout-coupon-field">
                <span>Coupon code</span>
                <Input
                  aria-label="Checkout coupon code"
                  className="uppercase"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="SAVE10"
                  aria-invalid={Boolean(fieldError)}
                />
                {fieldError ? <small className="checkout-field-error">{fieldError}</small> : null}
              </label>
            );
          }}
        </form.Field>
      </section>

      {selectionMessage ? <p role="alert" className="checkout-inline-warning">{selectionMessage}</p> : null}
      <FormError error={error} />
      <div className="checkout-form-actions">
        <Button type="submit" disabled={isPending || shippingOptions.isPending || shippingOptions.isError}>
          {isPending ? "Reviewing order..." : "Review order"}
        </Button>
        <p>Final prices, discounts, tax, stock and delivery charges are recalculated before you can place the order.</p>
      </div>
    </form>
  );
}
