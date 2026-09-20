import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { sellerApplicationFormSchema } from "../schemas/sellers.schemas";
import type { SubmitSellerApplicationInput } from "../types/sellers.types";

/** Collects the minimum business profile required by seller onboarding. */
export function SellerApplicationForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: SubmitSellerApplicationInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { legalName: "", displayName: "", taxId: "" },
    validators: { onChange: sellerApplicationFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit({
          legalName: value.legalName.trim(),
          displayName: value.displayName.trim(),
          taxId: value.taxId.trim() || null,
        });
      } catch {
        // The caller's TanStack Query mutation owns the safe error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="legalName">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Legal business name
              <input
                aria-label="Seller legal name"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="displayName">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Seller display name
              <input
                aria-label="Seller display name"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="taxId">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Tax ID <span className="font-normal text-slate-500">(optional)</span>
              <input
                aria-label="Seller tax ID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <FormError error={error} />
      <Button disabled={isPending}>{isPending ? "Submitting..." : "Submit seller application"}</Button>
    </form>
  );
}
