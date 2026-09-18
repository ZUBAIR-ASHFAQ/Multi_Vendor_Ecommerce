import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { customerAddressFormSchema, type CustomerAddressFormValues } from "../schemas/customers.schemas";
import type { CustomerAddress, CustomerAddressWriteInput } from "../types/customers.types";

/** Builds readable form defaults for a new or existing saved address. */
function addressDefaults(address?: CustomerAddress): CustomerAddressFormValues {
  return {
    label: address?.label ?? "",
    recipientName: address?.recipientName ?? "",
    phone: address?.phone ?? "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    city: address?.city ?? "",
    region: address?.region ?? "",
    postalCode: address?.postalCode ?? "",
    countryCode: address?.countryCode ?? "",
    isDefaultShipping: address?.isDefaultShipping ?? false,
    isDefaultBilling: address?.isDefaultBilling ?? false,
  };
}

/** Converts form strings into the nullable address fields accepted by the backend. */
function addressInput(value: CustomerAddressFormValues): CustomerAddressWriteInput {
  return {
    ...value,
    label: value.label.trim(),
    recipientName: value.recipientName.trim(),
    phone: value.phone.trim(),
    line1: value.line1.trim(),
    line2: value.line2.trim() || null,
    city: value.city.trim(),
    region: value.region.trim().replace(/\s+/g, " "),
    postalCode: value.postalCode.trim() || null,
    countryCode: value.countryCode.trim().toUpperCase(),
  };
}

/** Reusable TanStack Form for creating or editing one customer-owned saved address. */
export function CustomerAddressForm({
  address,
  submitLabel,
  isPending,
  error,
  resetAfterSubmit = false,
  onSubmit,
  onCancel,
}: {
  address?: CustomerAddress;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
  resetAfterSubmit?: boolean;
  onSubmit: (input: CustomerAddressWriteInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const form = useForm({
    defaultValues: addressDefaults(address),
    validators: { onChange: customerAddressFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(addressInput(value));
        if (resetAfterSubmit) form.reset();
      } catch {
        // The caller's TanStack Query mutation owns the safe error shown by FormError.
      }
    },
  });

  const textFields = [
    ["label", "Address label"],
    ["recipientName", "Recipient name"],
    ["phone", "Address phone"],
    ["line1", "Address line 1"],
    ["line2", "Address line 2"],
    ["city", "City"],
    ["region", "Region"],
    ["postalCode", "Postal code"],
    ["countryCode", "Country code"],
  ] as const;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {textFields.map(([name, label]) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="text-sm font-medium">
                  {label}
                  <input
                    aria-label={label}
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    maxLength={name === "countryCode" ? 2 : undefined}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {fieldError && <span className="mt-1 block text-xs text-red-600">{fieldError}</span>}
                </label>
              );
            }}
          </form.Field>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="isDefaultShipping">
          {(field) => (
            <label className="flex gap-2 rounded-md border p-3 text-sm">
              <input
                aria-label="Default shipping address"
                type="checkbox"
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
              />
              Use as default shipping address
            </label>
          )}
        </form.Field>
        <form.Field name="isDefaultBilling">
          {(field) => (
            <label className="flex gap-2 rounded-md border p-3 text-sm">
              <input
                aria-label="Default billing address"
                type="checkbox"
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
              />
              Use as default billing address
            </label>
          )}
        </form.Field>
      </div>

      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending}>{isPending ? "Saving..." : submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
