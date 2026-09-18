import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_PURPOSE_OPTIONS,
  hasDocumentPermission,
} from "../documents-audit.constants";
import { documentUploadFormSchema } from "../schemas/documents-audit.schemas";
import type {
  DocumentPurpose,
  UploadedDocumentResult,
} from "../types/documents-audit.types";
import { useUploadDocumentMutation } from "../hooks/use-documents-audit";

/** Collects a local file and purpose, then performs the complete constrained direct-upload workflow. */
export function FileUploadForm({
  user,
  onUploaded,
}: {
  user: AuthenticatedUser;
  onUploaded: (result: UploadedDocumentResult) => void;
}) {
  const upload = useUploadDocumentMutation();
  const canLink = hasDocumentPermission(
    user.permissions,
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
  );
  const form = useForm({
    defaultValues: {
      file: null as File | null,
      purpose: "operational_evidence" as DocumentPurpose,
      linkToAccount: false,
    },
    validators: { onChange: documentUploadFormSchema },
    onSubmit: async ({ value }) => {
      if (!(value.file instanceof File)) return;

      try {
        const result = await upload.mutateAsync({
          file: value.file,
          purpose: value.purpose,
          linkToAccount: canLink && value.linkToAccount,
          actorId: user.id,
        });
        onUploaded(result);
        form.reset();
      } catch {
        // TanStack Query owns the normalized mutation error rendered by FormError below.
      }
    },
  });

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-bold">Upload a document</h1>
      <p className="mt-1 text-sm text-slate-600">
        The API validates purpose, MIME type, and size. File bytes go directly to signed object storage.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="file">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                File
                <input
                  aria-label="File"
                  type="file"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.files?.[0] ?? null)}
                />
                {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="purpose">
          {(field) => (
            <label className="block text-sm font-medium">
              Purpose
              <select
                aria-label="Purpose"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as DocumentPurpose)}
              >
                {DOCUMENT_PURPOSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form.Field>

        {canLink && (
          <form.Field name="linkToAccount">
            {(field) => (
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  aria-label="Link to my account"
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
                <span>
                  <strong>Link to my account</strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    Current-stage linking is limited to your own Module 2 user resource. Future modules provide their own resource policies.
                  </span>
                </span>
              </label>
            )}
          </form.Field>
        )}

        <FormError error={upload.error} />
        <Button disabled={upload.isPending}>
          {upload.isPending ? "Uploading and verifying..." : "Upload document"}
        </Button>
      </form>
    </section>
  );
}
