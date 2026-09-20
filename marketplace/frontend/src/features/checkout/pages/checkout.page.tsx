import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { useCartQuery } from "@/features/cart-wishlist/hooks/use-cart-wishlist";
import { useCustomerAddressesQuery } from "@/features/customers/hooks/use-customers";
import { CheckoutPayment } from "@/features/payments/components/checkout-payment";
import { ApiClientError } from "@/lib/api-error";
import { CHECKOUT_PERMISSION } from "../checkout.constants";
import { CheckoutChangeWarning } from "../components/checkout-change-warning";
import { CheckoutExpiryWarning, checkoutQuoteIsExpired } from "../components/checkout-expiry-warning";
import { CheckoutLayout } from "../components/checkout-layout";
import { CheckoutQuoteSummary } from "../components/checkout-quote-summary";
import { CheckoutStepper } from "../components/checkout-stepper";
import { CheckoutQuoteForm } from "../forms/checkout-quote.form";
import {
  useCheckoutAttemptStatusQuery,
  useCheckoutQuoteQuery,
  useConfirmCheckoutQuoteMutation,
  useCreateCheckoutQuoteMutation,
} from "../hooks/use-checkout";
import type { CreateCheckoutQuoteInput } from "../types/checkout.types";

/** Returns a new browser-generated idempotency key for one quote confirmation lifecycle. */
function newConfirmationKey(): string {
  return crypto.randomUUID();
}

/** Renders the authenticated customer Checkout workflow without treating Payment or Order state as Module 10 state. */
function CheckoutContent({ canConfirm }: { canConfirm: boolean }) {
  const cart = useCartQuery();
  const addresses = useCustomerAddressesQuery();
  const createQuote = useCreateCheckoutQuoteMutation();
  const [quoteId, setQuoteId] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [confirmationKey, setConfirmationKey] = useState(newConfirmationKey);
  const quoteQuery = useCheckoutQuoteQuery(quoteId, quoteId.length > 0);
  const confirmQuote = useConfirmCheckoutQuoteMutation(quoteId);
  const attemptStatus = useCheckoutAttemptStatusQuery(attemptId, attemptId.length > 0);

  /** Creates a fresh quote and resets any previous attempt-specific UI state. */
  async function calculateQuote(input: CreateCheckoutQuoteInput): Promise<void> {
    const quote = await createQuote.mutateAsync(input);
    setQuoteId(quote.id);
    setAttemptId("");
    setConfirmationKey(newConfirmationKey());
    confirmQuote.reset();
  }

  /** Confirms the currently loaded quote with the same retry key until a new quote is calculated. */
  async function confirmCurrentQuote(): Promise<void> {
    const quote = quoteQuery.data;
    if (!quote) return;
    try {
      const attempt = await confirmQuote.mutateAsync({
        stateHash: quote.stateHash,
        idempotencyKey: confirmationKey,
      });
      setAttemptId(attempt.id);
    } catch {
      // TanStack Query owns the normalized request error rendered below.
    }
  }

  if (cart.isPending || addresses.isPending) {
    return <LoadingState label="Preparing Checkout..." />;
  }

  if (cart.isError) {
    return (
      <ErrorState
        title="Cart could not be loaded"
        message={cart.error instanceof Error ? cart.error.message : "Please try again."}
        requestId={cart.error instanceof ApiClientError ? cart.error.requestId : undefined}
        onRetry={() => void cart.refetch()}
      />
    );
  }

  if (addresses.isError) {
    return (
      <ErrorState
        title="Addresses could not be loaded"
        message={addresses.error instanceof Error ? addresses.error.message : "Please try again."}
        requestId={addresses.error instanceof ApiClientError ? addresses.error.requestId : undefined}
        onRetry={() => void addresses.refetch()}
      />
    );
  }

  if (cart.data.items.length === 0) {
    return (
      <section className="rounded-xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="mt-2 text-sm text-slate-600">Your Cart is empty. Add a Product before creating a Checkout quote.</p>
        <Button className="mt-4" asChild><Link to="/products">Browse Products</Link></Button>
      </section>
    );
  }

  if (addresses.data.length === 0) {
    return (
      <section className="rounded-xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">Checkout needs an address</h1>
        <p className="mt-2 text-sm text-slate-600">Add an active saved address before calculating shipping and authoritative totals.</p>
        <Button className="mt-4" asChild><Link to="/customer/addresses">Manage addresses</Link></Button>
      </section>
    );
  }

  const quote = quoteQuery.data;
  const quoteExpired = quote ? checkoutQuoteIsExpired(quote.expiresAt) : false;
  const activeStep = attemptId ? 4 : quote ? 3 : 1;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Module 10 · Checkout</p>
        <h1 className="mt-1 text-2xl font-bold">Checkout</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Cart totals are not trusted here. The backend recalculates price, discount, shipping, tax, and stock before confirmation.
        </p>
      </section>

      <CheckoutStepper activeStep={activeStep} />

      <CheckoutQuoteForm
        addresses={addresses.data}
        isPending={createQuote.isPending}
        error={createQuote.error}
        onSubmit={calculateQuote}
      />

      {quoteId && quoteQuery.isPending ? <LoadingState label="Loading authoritative quote..." /> : null}
      {quoteQuery.isError ? (
        <ErrorState
          title="Quote could not be loaded"
          message={quoteQuery.error instanceof Error ? quoteQuery.error.message : "Please recalculate Checkout."}
          requestId={quoteQuery.error instanceof ApiClientError ? quoteQuery.error.requestId : undefined}
          onRetry={() => void quoteQuery.refetch()}
        />
      ) : null}

      {quote ? (
        <>
          <CheckoutQuoteSummary quote={quote} cart={cart.data} />
          <CheckoutExpiryWarning expiresAt={quote.expiresAt} />
          <CheckoutChangeWarning error={confirmQuote.error} />

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step 4</p>
                <h2 className="mt-1 text-xl font-bold">Confirm &amp; pay</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  Confirmation creates the Checkout attempt and Inventory reservations. Payment capture remains owned
                  by the downstream Payments module.
                </p>
              </div>
              <Button
                type="button"
                disabled={!canConfirm || quoteExpired || confirmQuote.isPending || Boolean(attemptId)}
                onClick={() => void confirmCurrentQuote()}
              >
                {confirmQuote.isPending ? "Confirming..." : "Confirm & pay"}
              </Button>
            </div>
            {!canConfirm ? (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Your account can create quotes but does not have checkout.confirm_own permission.
              </p>
            ) : null}
            <FormError error={confirmQuote.error} />
          </section>
        </>
      ) : null}

      {attemptId ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Checkout attempt status">
          <h2 className="text-xl font-bold">Checkout attempt</h2>
          {attemptStatus.isPending ? <LoadingState label="Loading Checkout status..." /> : null}
          {attemptStatus.isError ? (
            <ErrorState
              title="Checkout status could not be loaded"
              message={attemptStatus.error instanceof Error ? attemptStatus.error.message : "Please try again."}
              requestId={attemptStatus.error instanceof ApiClientError ? attemptStatus.error.requestId : undefined}
              onRetry={() => void attemptStatus.refetch()}
            />
          ) : null}
          {attemptStatus.data ? (
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="font-semibold">Status:</span> {attemptStatus.data.status}</p>
              <p><span className="font-semibold">Attempt:</span> {attemptStatus.data.id}</p>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-700">
                Checkout is confirmed and the Order now exists. Payment capture is still provider-authoritative;
                this page does not mark an order paid.
              </p>
              {attemptStatus.data.orderId ? (
                <div className="mt-4">
                  <CheckoutPayment orderId={attemptStatus.data.orderId} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Protects the Checkout page and derives whether the actor may run the confirmation command. */
export function CheckoutPage() {
  return (
    <CheckoutLayout>
      {(user) => (
        <CheckoutContent canConfirm={user.permissions.includes(CHECKOUT_PERMISSION.CONFIRM_OWN)} />
      )}
    </CheckoutLayout>
  );
}
