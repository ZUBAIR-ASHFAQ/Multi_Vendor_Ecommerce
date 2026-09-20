import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-error";
import { env } from "@/lib/env";
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

  /** Moves to the provider-authoritative status page without trusting Stripe browser return state. */
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
      <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm" aria-label="Payment handoff">
        <ErrorState
          title="Secure payment could not be prepared"
          message={createIntent.error instanceof Error ? createIntent.error.message : "Please try again."}
          requestId={createIntent.error instanceof ApiClientError ? createIntent.error.requestId : undefined}
          onRetry={preparePayment}
        />
        <Button type="button" variant="outline" onClick={startFreshRetry}>
          Start a fresh retry
        </Button>
      </section>
    );
  }

  const intent = createIntent.data;

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Payment handoff">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Module 12 · Payments</p>
          <h2 className="mt-1 text-xl font-bold">Secure payment</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The Order already exists. Stripe handles card entry, while the marketplace backend remains authoritative for capture status.
          </p>
        </div>
        {intent ? <PaymentStatusBadge status={intent.status} /> : null}
      </div>

      {!intent ? (
        <div className="mt-4">
          <Button type="button" disabled={createIntent.isPending} onClick={preparePayment}>
            {createIntent.isPending ? "Preparing secure payment..." : "Continue to secure payment"}
          </Button>
        </div>
      ) : null}

      {intent ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-2 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <p><span className="font-semibold">Amount:</span> {intent.amount} {intent.currency}</p>
            <p><span className="font-semibold">Provider:</span> Stripe</p>
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
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Loading Stripe secure fields...</p>
          ) : (
            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
              This Payment no longer needs card entry. Open the marketplace status page for the authoritative result.
              <div className="mt-3">
                <Button type="button" variant="outline" onClick={showProcessingStatus}>
                  View payment status
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
