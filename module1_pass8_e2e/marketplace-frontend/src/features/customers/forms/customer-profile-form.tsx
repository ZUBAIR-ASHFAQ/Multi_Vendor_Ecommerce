import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { customerProfileFormSchema } from "../schemas/customers.schemas";
import type { CustomerProfile } from "../types/customers.types";
import { useUpdateCustomerProfileMutation } from "../hooks/use-customers";

/** Edits the authenticated customer's permitted profile fields. */
export function CustomerProfileForm({ profile }: { profile: CustomerProfile }) {
  const [saved, setSaved] = useState(false);
  const update = useUpdateCustomerProfileMutation();
  const form = useForm({
    defaultValues: {
      displayName: profile.displayName,
      phone: profile.phone ?? "",
      marketingOptIn: profile.marketingOptIn,
    },
    validators: { onChange: customerProfileFormSchema },
    onSubmit: async ({ value }) => {
      setSaved(false);
      try {
        await update.mutateAsync({
          displayName: value.displayName.trim(),
          phone: value.phone.trim() || null,
          marketingOptIn: value.marketingOptIn,
        });
        setSaved(true);
      } catch {
        // TanStack Query owns the normalized mutation error rendered below.
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
      <form.Field name="displayName">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Display name
              <input
                aria-label="Customer display name"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="phone">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Phone
              <input
                aria-label="Customer phone"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="marketingOptIn">
        {(field) => (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              aria-label="Marketing opt in"
              type="checkbox"
              checked={field.state.value}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
            <span>
              <strong>Marketing updates</strong>
              <span className="mt-1 block text-xs text-slate-500">Allow non-transactional marketplace updates.</span>
            </span>
          </label>
        )}
      </form.Field>

      {saved && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Profile saved.</p>}
      <FormError error={update.error} />
      <Button disabled={update.isPending}>{update.isPending ? "Saving..." : "Save profile"}</Button>
    </form>
  );
}
