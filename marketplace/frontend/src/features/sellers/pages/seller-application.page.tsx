import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { DOCUMENT_AUDIT_PERMISSION } from "@/features/documents-audit/documents-audit.constants";
import { SellerApplicationForm } from "../forms/seller-application-form";
import { SellerVerificationUpload } from "../components/seller-verification-upload";
import { useSubmitSellerApplicationMutation } from "../hooks/use-sellers";

/** Protects the seller-application route and keeps the application limited to customer accounts. */
export function SellerApplicationPage() {
  const submit = useSubmitSellerApplicationMutation();

  return (
    <AuthenticatedPanel>
      {(user) => {
        if (user.accountType !== "customer") {
          return (
            <ErrorState
              title="Customer account required"
              message="Seller applications are submitted from an existing customer account before seller approval."
            />
          );
        }

        return (
          <div className="space-y-5">
            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Seller onboarding</p>
              <h1 className="mt-1 text-2xl font-bold">Apply to become a seller</h1>
              <p className="mt-2 text-sm text-slate-600">
                Submit the business profile used by the marketplace review process. Approval status and seller
                ownership are always decided by the server.
              </p>
              <div className="mt-5">
                {submit.data ? (
                  <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-900">
                    <strong>Application submitted.</strong>
                    <span className="mt-1 block">Application ID: {submit.data.id}</span>
                    <span className="mt-1 block">Status: {submit.data.status}</span>
                  </div>
                ) : (
                  <SellerApplicationForm
                    isPending={submit.isPending}
                    error={submit.error}
                    onSubmit={async (input) => {
                      await submit.mutateAsync(input);
                    }}
                  />
                )}
              </div>
            </section>

            {submit.data &&
            user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD) &&
            user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK) ? (
              <SellerVerificationUpload applicationId={submit.data.id} />
            ) : null}
          </div>
        );
      }}
    </AuthenticatedPanel>
  );
}
