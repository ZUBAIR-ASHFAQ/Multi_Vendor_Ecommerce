const CHECKOUT_STEPS = ["Address", "Delivery", "Review", "Payment"] as const;

/** Shows the customer-facing Checkout progression while preserving the existing quote/attempt lifecycle. */
export function CheckoutStepper({ activeStep }: { activeStep: number }) {
  return (
    <ol className="checkout-stepper" aria-label="Checkout progress">
      {CHECKOUT_STEPS.map((label, index) => {
        const step = index + 1;
        const isActive = step === activeStep;
        const isComplete = step < activeStep;
        return (
          <li
            key={label}
            className={`checkout-step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="checkout-step-number" aria-hidden="true">
              {isComplete ? "✓" : step}
            </span>
            <span className="checkout-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
