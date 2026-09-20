import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { SellerLayout, RequireSellerPermission } from "../components/seller-layout";
import { SellerProfileForm } from "../forms/seller-profile-form";
import { useMySellerQuery } from "../hooks/use-sellers";
import { hasSellerPermission, SELLER_PERMISSION } from "../sellers.constants";

/** Loads the seller master and renders profile, lifecycle, store, and staff summaries. */
function SellerProfileContent({ canUpdate, canManageStaff }: { canUpdate: boolean; canManageStaff: boolean }) {
  const seller = useMySellerQuery();

  if (seller.isPending) return <LoadingState label="Loading seller profile..." />;
  if (seller.isError) {
    return (
      <ErrorState
        title="Seller profile could not be loaded"
        message={seller.error instanceof Error ? seller.error.message : "Please try again."}
        onRetry={() => void seller.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Seller profile</p>
            <h1 className="mt-1 text-2xl font-bold">{seller.data.seller.displayName}</h1>
            <p className="mt-1 text-sm text-slate-600">
              Status: {seller.data.seller.status} · Approval: {seller.data.seller.approvalStatus}
            </p>
          </div>
          <Link className="text-sm font-medium underline" to="/seller/stores">Manage stores</Link>
        </div>
        <div className="mt-5">
          {canUpdate ? (
            <SellerProfileForm seller={seller.data.seller} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-slate-500">Legal name</dt><dd>{seller.data.seller.legalName}</dd></div>
              <div><dt className="text-xs uppercase text-slate-500">Tax ID</dt><dd>{seller.data.seller.taxId ?? "Not set"}</dd></div>
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Seller staff summary</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-slate-500">Total</dt>
            <dd className="text-2xl font-bold">{seller.data.staffSummary.totalCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Active</dt>
            <dd className="text-2xl font-bold">{seller.data.staffSummary.activeCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Inactive</dt>
            <dd className="text-2xl font-bold">{seller.data.staffSummary.inactiveCount}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-slate-600">
          Staff access is owned by Administration role assignments. Module 4 mirrors those seller-scoped
          memberships into the seller staff ledger.
        </p>
        {canManageStaff ? (
          <Link className="mt-3 inline-block text-sm font-medium underline" to="/seller/staff">Manage seller staff access</Link>
        ) : null}
      </section>
    </div>
  );
}

/** Protects the seller profile page with the Module 4 seller-profile permission. */
export function SellerProfilePage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={SELLER_PERMISSION.PROFILE_READ}>
          <SellerProfileContent
            canUpdate={hasSellerPermission(user.permissions, SELLER_PERMISSION.PROFILE_MANAGE)}
            canManageStaff={hasSellerPermission(user.permissions, SELLER_PERMISSION.STAFF_MANAGE)}
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
