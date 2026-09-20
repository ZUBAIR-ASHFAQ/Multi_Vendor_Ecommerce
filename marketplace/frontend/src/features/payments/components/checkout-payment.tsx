import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { useCreatePaymentIntentMutation } from "../hooks/use-payments";
import { PaymentElementForm } from "../forms/payment-element-form";
import { PaymentStatusBadge } from "./payment-status-badge";

/** Creates one browser retry key that stays stable while the current Payment handoff remains mounted. */
function newPaymentIntentKey(): string {
  return crypto.randomUUID();
}

/** Starts the Stripe Payment Element only after Checkout has already created a parent Order. */
export function CheckoutPayment({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const [idempotencyKey, setIdempotencyKey] = useState(newPaymentIntentKey);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const createIntent = useCreatePaymentIntentMutation(orderId);

  /** Prepares the PaymentIntent and loads Stripe.js only when a client secret is actually available. */
  function preparePayment(): void {
    createIntent.mutate(idempotencyKey, {
      onSuccess: (intent) => {
        if (intent.clientSecret) {
          setStripePromise(loadStripe(env.VITE_STRIPE_PUBLISHABLE_KEY));
        }
      },
    });
  }

  /** Moves to the marketplace payment-status page after Stripe accepts the browser confirmation. */
  function showProcessingStatus(): void {
    void navigate({ to: "/payments/orders/$orderId", params: { orderId } });
  }

  /** Starts a new safe browser retry key after a terminal client-side preparation error. */
  function startFreshRetry(): void {
    setIdempotencyKey(newPaymentIntentKey());
    setStripePromise(null);
    createIntent.reset();
  }

  if (createIntent.isError) {
    return (
      <div className="checkout-secure-payment" aria-label="Payment handoff">
        <ErrorState
          title="Secure payment could not be prepared"
          message={createIntent.error instanceof Error ? createIntent.error.message : "Please try again."}
          requestId={createIntent.error instanceof ApiClientError ? createIntent.error.requestId : undefined}
          onRetry={preparePayment}
        />
        <Button type="button" variant="outline" onClick={startFreshRetry}>
          Start a fresh retry
        </Button>
      </div>
    );
  }

  const intent = createIntent.data;

  return (
    <div className="checkout-secure-payment" aria-label="Payment handoff">
      <div className="checkout-secure-payment-heading">
        <div>
          <p>Protected payment</p>
          <h3>Secure payment</h3>
          <span>Pay safely with Stripe. Your card details are entered directly into Stripe's secure payment fields.</span>
        </div>
        {intent ? <PaymentStatusBadge status={intent.status} /> : null}
      </div>

      {!intent ? (
        <Button type="button" disabled={createIntent.isPending} onClick={preparePayment}>
          {createIntent.isPending ? "Preparing secure payment..." : "Continue to secure payment"}
        </Button>
      ) : null}

      {intent ? (
        <div className="checkout-secure-payment-body">
          <div className="checkout-payment-amount">
            <span>Amount due</span>
            <strong>{formatMoney(intent.amount, intent.currency)}</strong>
          </div>

          {intent.clientSecret && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: intent.clientSecret,
                appearance: { theme: "stripe" },
              }}
            >
              <PaymentElementForm orderId={orderId} onProcessing={showProcessingStatus} />
            </Elements>
          ) : intent.clientSecret ? (
            <p className="checkout-state-message checkout-state-message-neutral">Loading secure payment fields...</p>
          ) : (
            <div className="checkout-state-message checkout-state-message-neutral">
              <p>This payment no longer needs card entry. Open payment status for the latest result.</p>
              <Button type="button" variant="outline" onClick={showProcessingStatus}>
                View payment status
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
