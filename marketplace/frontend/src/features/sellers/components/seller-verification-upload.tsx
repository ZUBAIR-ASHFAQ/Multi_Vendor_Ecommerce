import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { DOCUMENT_PURPOSE } from "@/features/documents-audit/documents-audit.constants";
import { documentUploadFormSchema } from "@/features/documents-audit/schemas/documents-audit.schemas";
import { useUploadDocumentToResourceMutation } from "@/features/documents-audit/hooks/use-documents-audit";

/** Uploads and links optional seller-verification evidence to the submitted application. */
export function SellerVerificationUpload({ applicationId }: { applicationId: string }) {
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const upload = useUploadDocumentToResourceMutation();
  const form = useForm({
    defaultValues: {
      file: null as File | null,
      purpose: DOCUMENT_PURPOSE.SELLER_VERIFICATION,
      linkToAccount: false,
    },
    validators: { onChange: documentUploadFormSchema },
    onSubmit: async ({ value }) => {
      if (!(value.file instanceof File)) return;
      try {
        const result = await upload.mutateAsync({
          file: value.file,
          purpose: DOCUMENT_PURPOSE.SELLER_VERIFICATION,
          resourceType: "seller_application",
          resourceId: applicationId,
        });
        setUploadedName(result.file.originalName);
        form.reset();
      } catch {
        // TanStack Query owns the normalized upload/link error rendered below.
      }
    },
  });

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Verification document</h2>
      <p className="mt-1 text-sm text-slate-600">
        Optional verification files use Module 21 signed storage and are linked only to this seller application.
      </p>
      <form
        className="mt-4 space-y-3"
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
                Verification file
                <input
                  aria-label="Seller verification file"
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
        {uploadedName ? (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            Linked verification file: {uploadedName}
          </p>
        ) : null}
        <FormError error={upload.error} />
        <Button disabled={upload.isPending}>
          {upload.isPending ? "Uploading..." : "Upload verification file"}
        </Button>
      </form>
    </section>
  );
}
