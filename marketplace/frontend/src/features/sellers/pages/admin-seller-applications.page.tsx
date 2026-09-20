import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { PaginationControls } from "@/features/administration/components/pagination-controls";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { SellerApplicationCard } from "../components/seller-application-card";
import { SellerApplicationFilterForm } from "../forms/seller-application-filter-form";
import { useSellerApplicationsQuery } from "../hooks/use-sellers";
import { SELLER_APPLICATION_SORT, SELLER_PERMISSION } from "../sellers.constants";
import type { SellerApplicationListParams } from "../types/sellers.types";

/** Loads and renders the permission-scoped seller-application review queue. */
function SellerApplicationsContent() {
  const [params, setParams] = useState<SellerApplicationListParams>({
    page: 1,
    pageSize: 20,
    sort: SELLER_APPLICATION_SORT.CREATED_DESC,
  });
  const applications = useSellerApplicationsQuery(params);

  /** Applies validated filters and returns the review queue to page one. */
  function applyFilters(filters: SellerApplicationListParams): void {
    setParams({ ...filters, page: 1, pageSize: 20 });
  }

  /** Changes only the current review-queue page while preserving active filters. */
  function changePage(page: number): void {
    setParams((current) => ({ ...current, page }));
  }

  return (
    <div className="space-y-5">
      <SellerApplicationFilterForm onApply={applyFilters} />
      {applications.isPending ? <LoadingState label="Loading seller applications..." /> : null}
      {applications.isError ? (
        <ErrorState
          title="Seller applications could not be loaded"
          message={applications.error instanceof Error ? applications.error.message : "Please try again."}
          onRetry={() => void applications.refetch()}
        />
      ) : null}
      {applications.data ? (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Seller applications</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review submitted seller business profiles without changing client-owned approval state.
            </p>
          </div>
          {applications.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No seller applications match these filters.</p>
          ) : (
            applications.data.items.map((application) => (
              <SellerApplicationCard key={application.id} application={application} />
            ))
          )}
          <PaginationControls meta={applications.data.meta} onPage={changePage} />
        </section>
      ) : null}
    </div>
  );
}

/** Protects the seller-application review page with the Module 4 admin-review permission. */
export function AdminSellerApplicationsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={SELLER_PERMISSION.ADMIN_REVIEW}>
          <SellerApplicationsContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
