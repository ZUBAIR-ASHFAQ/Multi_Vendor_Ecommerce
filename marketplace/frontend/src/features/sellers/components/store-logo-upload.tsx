import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { DOCUMENT_PURPOSE } from "@/features/documents-audit/documents-audit.constants";
import { documentUploadFormSchema } from "@/features/documents-audit/schemas/documents-audit.schemas";
import { useUploadDocumentToResourceMutation } from "@/features/documents-audit/hooks/use-documents-audit";
import { useUpdateStoreMutation } from "../hooks/use-sellers";
import type { SellerStore } from "../types/sellers.types";

/** Uploads a confirmed store asset, links it to the store, and assigns its file ID as the current logo. */
export function StoreLogoUpload({ store }: { store: SellerStore }) {
  const [savedName, setSavedName] = useState<string | null>(null);
  const upload = useUploadDocumentToResourceMutation();
  const updateStore = useUpdateStoreMutation(store.id);
  const form = useForm({
    defaultValues: {
      file: null as File | null,
      purpose: DOCUMENT_PURPOSE.STORE_ASSET,
      linkToAccount: false,
    },
    validators: { onChange: documentUploadFormSchema },
    onSubmit: async ({ value }) => {
      if (!(value.file instanceof File)) return;
      try {
        const result = await upload.mutateAsync({
          file: value.file,
          purpose: DOCUMENT_PURPOSE.STORE_ASSET,
          resourceType: "store",
          resourceId: store.id,
        });
        await updateStore.mutateAsync({ logoFileId: result.file.id });
        setSavedName(result.file.originalName);
        form.reset();
      } catch {
        // The upload or store update mutation exposes a safe error below.
      }
    },
  });
  const error = upload.error ?? updateStore.error;
  const isPending = upload.isPending || updateStore.isPending;

  return (
    <div className="rounded-md border p-4">
      <p className="font-medium">Store logo</p>
      <p className="mt-1 text-xs text-slate-500">
        {store.logoFileId ? "A confirmed store asset is assigned." : "No store logo is assigned yet."}
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="file">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Logo file
                <input
                  aria-label={`Store logo file ${store.id}`}
                  type="file"
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.files?.[0] ?? null)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>
        {savedName ? <p className="text-sm text-emerald-700">Logo updated from {savedName}.</p> : null}
        <FormError error={error} />
        <Button size="sm" variant="outline" disabled={isPending}>
          {isPending ? "Updating logo..." : "Upload logo"}
        </Button>
      </form>
    </div>
  );
}
