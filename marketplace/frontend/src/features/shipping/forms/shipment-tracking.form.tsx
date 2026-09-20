import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { shipmentTrackingFormSchema } from "../schemas/shipping.schemas";
import type { UpdateShipmentTrackingInput } from "../types/shipping.types";

/** Edits only carrier/tracking metadata; Shipment lifecycle status stays server-owned. */
export function ShipmentTrackingForm({
  carrier,
  trackingNo,
  serviceLevel,
  disabled,
  isPending,
  error,
  onSubmit,
}: {
  carrier: string | null;
  trackingNo: string | null;
  serviceLevel: string | null;
  disabled: boolean;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: UpdateShipmentTrackingInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      carrier: carrier ?? "",
      trackingNo: trackingNo ?? "",
      serviceLevel: serviceLevel ?? "",
    },
    validators: { onChange: shipmentTrackingFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = shipmentTrackingFormSchema.parse(value);
      try {
        await onSubmit({
          carrier: parsed.carrier,
          trackingNo: parsed.trackingNo,
          serviceLevel: parsed.serviceLevel || null,
        });
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <form.Field name="carrier">
          {(field) => {
            const errorMessage = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Carrier
                <input
                  aria-label="Shipment carrier"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  disabled={disabled}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {errorMessage ? <span className="mt-1 block text-xs text-red-600">{errorMessage}</span> : null}
              </label>
            );
          }}
        </form.Field>
        <form.Field name="trackingNo">
          {(field) => {
            const errorMessage = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Tracking number
                <input
                  aria-label="Shipment tracking number"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  disabled={disabled}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {errorMessage ? <span className="mt-1 block text-xs text-red-600">{errorMessage}</span> : null}
              </label>
            );
          }}
        </form.Field>
        <form.Field name="serviceLevel">
          {(field) => (
            <label className="text-sm font-medium">
              Service level <span className="font-normal text-slate-500">(optional)</span>
              <input
                aria-label="Shipment service level"
                className="mt-1 w-full rounded-md border px-3 py-2"
                disabled={disabled}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
      </div>
      <FormError error={error} />
      <Button type="submit" size="sm" variant="outline" disabled={disabled || isPending}>
        {isPending ? "Saving tracking..." : "Save tracking"}
      </Button>
    </form>
  );
}
