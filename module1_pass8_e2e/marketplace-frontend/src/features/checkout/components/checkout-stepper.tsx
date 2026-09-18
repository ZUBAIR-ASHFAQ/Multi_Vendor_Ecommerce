const CHECKOUT_STEPS = ["Address", "Shipping", "Review", "Confirm"] as const;

/** Shows the short Checkout workflow without pretending later Order or Payment state exists. */
export function CheckoutStepper({ activeStep }: { activeStep: number }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Checkout progress">
      {CHECKOUT_STEPS.map((label, index) => {
        const step = index + 1;
        const isActive = step === activeStep;
        const isComplete = step < activeStep;
        return (
          <li
            key={label}
            className={`rounded-lg border px-3 py-2 text-sm ${
              isActive
                ? "border-slate-900 bg-slate-900 text-white"
                : isComplete
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : "bg-white text-slate-500"
            }`}
          >
            <span className="font-semibold">{step}.</span> {label}
          </li>
        );
      })}
    </ol>
  );
}
