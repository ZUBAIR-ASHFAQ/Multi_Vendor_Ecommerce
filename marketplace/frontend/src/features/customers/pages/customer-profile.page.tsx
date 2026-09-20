import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CustomerLayout, RequireCustomerPermission } from "../components/customer-layout";
import { CUSTOMER_PERMISSION, hasCustomerPermission } from "../customers.constants";
import { CustomerProfileForm } from "../forms/customer-profile-form";
import { useCustomerProfileQuery } from "../hooks/use-customers";

/** Loads and renders the authenticated customer's commerce profile. */
function CustomerProfileContent({ canUpdate }: { canUpdate: boolean }) {
  const profile = useCustomerProfileQuery();

  if (profile.isPending) return <LoadingState label="Loading customer profile..." />;
  if (profile.isError) {
    return (
      <ErrorState
        title="Customer profile could not be loaded"
        message={profile.error instanceof Error ? profile.error.message : "Please try again."}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">My profile</p>
            <h1 className="mt-1 text-2xl font-bold">{profile.data.displayName}</h1>
            <p className="mt-1 text-sm text-slate-600">Profile status: {profile.data.status}</p>
          </div>
          <a className="text-sm font-medium underline" href="#order-summary">Order summary</a>
        </div>

        <div className="mt-5">
          {canUpdate ? (
            <CustomerProfileForm profile={profile.data} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-slate-500">Phone</dt><dd>{profile.data.phone ?? "Not set"}</dd></div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Marketing</dt>
                <dd>{profile.data.marketingOptIn ? "Opted in" : "Opted out"}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section id="order-summary" className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Order summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          Module 3 provides the navigation seam only. Order data and customer order history are owned by Module 11 and are not
          invented here.
        </p>
      </section>
    </div>
  );
}

/** Protects the customer profile route with the backend-defined self-service permission. */
export function CustomerProfilePage() {
  return (
    <CustomerLayout>
      {(user) => (
        <RequireCustomerPermission user={user} permission={CUSTOMER_PERMISSION.PROFILE_READ_OWN}>
          <CustomerProfileContent
            canUpdate={hasCustomerPermission(user.permissions, CUSTOMER_PERMISSION.PROFILE_UPDATE_OWN)}
          />
        </RequireCustomerPermission>
      )}
    </CustomerLayout>
  );
}
