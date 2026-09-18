import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { sellerProfileFormSchema } from "../schemas/sellers.schemas";
import type { Seller } from "../types/sellers.types";
import { useUpdateSellerProfileMutation } from "../hooks/use-sellers";

/** Edits only seller-master fields that the Module 4 API allows the seller to change. */
export function SellerProfileForm({ seller }: { seller: Seller }) {
  const [saved, setSaved] = useState(false);
  const update = useUpdateSellerProfileMutation();
  const form = useForm({
    defaultValues: {
      legalName: seller.legalName,
      displayName: seller.displayName,
      taxId: seller.taxId ?? "",
    },
    validators: { onChange: sellerProfileFormSchema },
    onSubmit: async ({ value }) => {
      setSaved(false);
      try {
        await update.mutateAsync({
          legalName: value.legalName.trim(),
          displayName: value.displayName.trim(),
          taxId: value.taxId.trim() || null,
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
      <form.Field name="legalName">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Legal business name
              <input
                aria-label="Seller profile legal name"
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
                aria-label="Seller profile display name"
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
                aria-label="Seller profile tax ID"
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

      {saved ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Seller profile saved.</p> : null}
      <FormError error={update.error} />
      <Button disabled={update.isPending}>{update.isPending ? "Saving..." : "Save seller profile"}</Button>
    </form>
  );
}
