import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { rejectSellerApplicationFormSchema } from "../schemas/sellers.schemas";
import { SELLER_APPLICATION_STATUS } from "../sellers.constants";
import type { SellerApplication } from "../types/sellers.types";
import {
  useApproveSellerApplicationMutation,
  useRejectSellerApplicationMutation,
} from "../hooks/use-sellers";

/** Renders one seller application and the explicit approve/reject review commands. */
export function SellerApplicationCard({ application }: { application: SellerApplication }) {
  const approve = useApproveSellerApplicationMutation();
  const reject = useRejectSellerApplicationMutation();
  const form = useForm({
    defaultValues: { reason: "" },
    validators: { onChange: rejectSellerApplicationFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await reject.mutateAsync({ id: application.id, reason: value.reason.trim() });
        form.reset();
      } catch {
        // TanStack Query owns the normalized rejection error rendered below.
      }
    },
  });
  const submitted = application.status === SELLER_APPLICATION_STATUS.SUBMITTED;

  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{application.businessProfile.displayName}</h2>
          <p className="text-sm text-slate-600">{application.businessProfile.legalName}</p>
          <p className="mt-1 text-xs text-slate-500">Applicant: {application.applicantUserId}</p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase">{application.status}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase text-slate-500">Tax ID</dt>
          <dd>{application.businessProfile.taxId ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Submitted</dt>
          <dd>{new Date(application.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      {application.reason ? <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm">Reason: {application.reason}</p> : null}

      {submitted ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <Button
              disabled={approve.isPending || reject.isPending}
              onClick={() => approve.mutate(application.id)}
            >
              {approve.isPending ? "Approving..." : "Approve application"}
            </Button>
            {approve.data ? (
              <p className="mt-2 text-xs text-emerald-700">Created seller ID: {approve.data.seller.id}</p>
            ) : null}
            <FormError error={approve.error} />
          </div>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="reason">
              {(field) => {
                const fieldError = firstFieldError(field.state.meta.errors);
                return (
                  <label className="block text-sm font-medium">
                    Rejection reason
                    <input
                      aria-label={`Rejection reason ${application.id}`}
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
            <FormError error={reject.error} />
            <Button type="submit" variant="outline" disabled={approve.isPending || reject.isPending}>
              {reject.isPending ? "Rejecting..." : "Reject application"}
            </Button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
