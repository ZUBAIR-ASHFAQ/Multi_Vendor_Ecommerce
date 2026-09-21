import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
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

/** Renders the authenticated customer Checkout workflow without changing server authority boundaries. */
function CheckoutContent({ canConfirm, displayName }: { canConfirm: boolean; displayName: string }) {
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
      <section className="checkout-empty-state">
        <h1>Checkout</h1>
        <p>Your cart is empty. Add something you love before continuing to Checkout.</p>
        <Button asChild><Link to="/products">Browse Products</Link></Button>
      </section>
    );
  }

  if (addresses.data.length === 0) {
    return (
      <section className="checkout-empty-state">
        <h1>Checkout needs an address</h1>
        <p>Add a saved delivery address before choosing shipping and reviewing your order.</p>
        <Button asChild><Link to="/customer/addresses">Manage addresses</Link></Button>
      </section>
    );
  }

  const quote = quoteQuery.data ?? null;
  const quoteExpired = quote ? checkoutQuoteIsExpired(quote.expiresAt) : false;
  const activeStep = attemptId ? 4 : quote ? 3 : 2;
  const storeNamesById = new Map(
    cart.data.items.flatMap((item) => item.storeId ? [[item.storeId, item.storeName ?? "Marketplace seller"] as const] : []),
  );

  return (
    <div className="checkout-page">
      <header className="checkout-page-heading">
        <div>
          <p>Secure checkout</p>
          <h1>Checkout</h1>
          <span>Signed in as {displayName}. Review delivery details, confirm your order, then pay securely.</span>
        </div>
        <Link to="/cart">Edit cart</Link>
      </header>

      <CheckoutStepper activeStep={activeStep} />

      <div className="checkout-content-grid">
        <section className="checkout-flow-column" aria-label="Checkout steps">
          <CheckoutQuoteForm
            addresses={addresses.data}
            storeNamesById={storeNamesById}
            isPending={createQuote.isPending}
            error={createQuote.error}
            onSubmit={calculateQuote}
          />

          {quoteId && quoteQuery.isPending ? <LoadingState label="Reviewing your latest order totals..." /> : null}
          {quoteQuery.isError ? (
            <ErrorState
              title="Order review could not be loaded"
              message={quoteQuery.error instanceof Error ? quoteQuery.error.message : "Please review your order again."}
              requestId={quoteQuery.error instanceof ApiClientError ? quoteQuery.error.requestId : undefined}
              onRetry={() => void quoteQuery.refetch()}
            />
          ) : null}

          {quote ? (
            <section className="checkout-confirm-card" aria-labelledby="checkout-confirm-heading">
              <div className="checkout-section-heading">
                <div>
                  <p>Step 3</p>
                  <h2 id="checkout-confirm-heading">Review and place order</h2>
                  <span>Check the final total in the order summary before creating your order.</span>
                </div>
              </div>

              <CheckoutExpiryWarning expiresAt={quote.expiresAt} />
              <CheckoutChangeWarning error={confirmQuote.error} />

              {!canConfirm ? (
                <p className="checkout-inline-warning">
                  Your account can review this order but does not have permission to place it.
                </p>
              ) : null}
              <FormError error={confirmQuote.error} />

              <div className="checkout-place-order-row">
                <div>
                  <strong>Ready to continue?</strong>
                  <span>Your order is created only after the latest price and stock checks pass.</span>
                </div>
                <Button
                  type="button"
                  disabled={!canConfirm || quoteExpired || confirmQuote.isPending || Boolean(attemptId)}
                  onClick={() => void confirmCurrentQuote()}
                >
                  {confirmQuote.isPending ? "Placing order..." : "Confirm & pay"}
                </Button>
              </div>
            </section>
          ) : null}

          {attemptId ? (
            <section className="checkout-payment-card" aria-label="Checkout attempt status">
              <div className="checkout-section-heading checkout-payment-heading">
                <div>
                  <p>Step 4</p>
                  <h2>Payment</h2>
                  <span>Your order is created. Complete secure payment to finish Checkout.</span>
                </div>
                {attemptStatus.data ? (
                  <StatusPill tone={attemptStatus.data.status === "confirmed" ? "positive" : "warning"}>
                    {attemptStatus.data.status}
                  </StatusPill>
                ) : null}
              </div>

              {attemptStatus.isPending ? <LoadingState label="Preparing payment..." /> : null}
              {attemptStatus.isError ? (
                <ErrorState
                  title="Checkout status could not be loaded"
                  message={attemptStatus.error instanceof Error ? attemptStatus.error.message : "Please try again."}
                  requestId={attemptStatus.error instanceof ApiClientError ? attemptStatus.error.requestId : undefined}
                  onRetry={() => void attemptStatus.refetch()}
                />
              ) : null}
              {attemptStatus.data ? (
                <div className="checkout-payment-ready">
                  <p>Your order has been created. Payment is completed only after secure confirmation from Stripe.</p>
                  {attemptStatus.data.orderId ? (
                    <CheckoutPayment orderId={attemptStatus.data.orderId} />
                  ) : (
                    <p className="checkout-state-message checkout-state-message-neutral">
                      Your order is being prepared for payment. Refresh this status if payment does not appear shortly.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </section>

        <div className="checkout-summary-column">
          <CheckoutQuoteSummary quote={quote} cart={cart.data} />
        </div>
      </div>
    </div>
  );
}

/** Protects the Checkout page and derives whether the actor may run the confirmation command. */
export function CheckoutPage() {
  return (
    <CheckoutLayout>
      {(user) => (
        <CheckoutContent
          canConfirm={user.permissions.includes(CHECKOUT_PERMISSION.CONFIRM_OWN)}
          displayName={user.displayName}
        />
      )}
    </CheckoutLayout>
  );
}
