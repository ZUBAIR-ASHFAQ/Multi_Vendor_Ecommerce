import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

interface PaymentElementFormProps {
  orderId: string;
  onProcessing: () => void;
}

/** Submits only Stripe-owned Payment Element data; card details never pass through marketplace APIs. */
export function PaymentElementForm({ orderId, onProcessing }: PaymentElementFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  /** Confirms the PaymentIntent through Stripe.js and then defers final truth to the marketplace status API. */
  async function submitPayment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!stripe || !elements || isSubmitting) return;

    setIsSubmitting(true);
    setMessage("");

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payments/orders/${orderId}`,
      },
      redirect: "if_required",
    });

    setIsSubmitting(false);

    if (result.error) {
      setMessage(result.error.message ?? "Stripe could not confirm the payment. Please review the form and try again.");
      return;
    }

    onProcessing();
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submitPayment(event)}>
      <div className="rounded-lg border p-4">
        <PaymentElement />
      </div>
      {message ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={!stripe || !elements || isSubmitting}>
        {isSubmitting ? "Confirming payment..." : "Pay securely"}
      </Button>
      <p className="text-xs text-slate-500">
        Card details are handled by Stripe. Marketplace servers never receive card PAN or CVC values.
      </p>
    </form>
  );
}
