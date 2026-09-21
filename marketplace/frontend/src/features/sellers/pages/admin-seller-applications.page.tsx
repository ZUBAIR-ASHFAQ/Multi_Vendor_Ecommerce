import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  AdminQueueEmpty,
  AdminQueueHeader,
  AdminQueueTable,
  AdminQueueTableHead,
} from "@/features/administration/components/admin-queue";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { PaginationControls } from "@/features/administration/components/pagination-controls";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { formatDateTime } from "@/lib/dates";
import { SellerApplicationCard } from "../components/seller-application-card";
import { SellerApplicationFilterForm } from "../forms/seller-application-filter-form";
import { useSellerApplicationsQuery } from "../hooks/use-sellers";
import { SELLER_APPLICATION_SORT, SELLER_PERMISSION } from "../sellers.constants";
import type { SellerApplicationListParams, SellerApplicationStatus } from "../types/sellers.types";

/** Maps seller-application status to the shared status-pill tone. */
function applicationTone(status: SellerApplicationStatus): "warning" | "positive" | "negative" {
  if (status === "approved") return "positive";
  if (status === "rejected") return "negative";
  return "warning";
}

/** Loads and renders the permission-scoped seller-application review queue. */
function SellerApplicationsContent() {
  const [params, setParams] = useState<SellerApplicationListParams>({
    page: 1,
    pageSize: 20,
    sort: SELLER_APPLICATION_SORT.CREATED_DESC,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const applications = useSellerApplicationsQuery(params);

  /** Applies validated filters and returns the review queue to page one. */
  function applyFilters(filters: SellerApplicationListParams): void {
    setSelectedId(null);
    setParams({ ...filters, page: 1, pageSize: 20 });
  }

  /** Changes only the current review-queue page while preserving active filters. */
  function changePage(page: number): void {
    setSelectedId(null);
    setParams((current) => ({ ...current, page }));
  }

  const selected = applications.data?.items.find((application) => application.id === selectedId);

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Marketplace · Seller onboarding"
        title="Seller application queue"
        description="Review submitted business profiles using the existing approval lifecycle. The queue only exposes fields returned by the seller-application API."
        meta={applications.data?.meta}
        visibleCount={applications.data?.items.length}
      />

      <SellerApplicationFilterForm onApply={applyFilters} />

      {applications.isPending ? <LoadingState variant="table" label="Loading seller applications..." /> : null}
      {applications.isError ? (
        <ErrorState
          title="Seller applications could not be loaded"
          message={applications.error instanceof Error ? applications.error.message : "Please try again."}
          onRetry={() => void applications.refetch()}
        />
      ) : null}

      {applications.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No seller applications match these filters"
          description="Change the application status or sort order to inspect another part of the onboarding queue."
        />
      ) : null}

      {applications.data?.items.length ? (
        <AdminQueueTable>
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Applicant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {applications.data.items.map((application) => (
              <tr key={application.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{application.businessProfile.displayName}</strong>
                  <span className="block text-xs text-foreground-muted">{application.businessProfile.legalName}</span>
                </td>
                <td className="px-4 py-3 break-all text-xs text-foreground-muted">{application.applicantUserId}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={applicationTone(application.status)}>{application.status.replaceAll("_", " ")}</StatusPill>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(application.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedId === application.id ? "secondary" : "outline"}
                    onClick={() => setSelectedId((current) => current === application.id ? null : application.id)}
                  >
                    {selectedId === application.id ? "Close review" : "Review"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {selected ? (
        <section aria-label={`Review seller application ${selected.businessProfile.displayName}`}>
          <SellerApplicationCard application={selected} />
        </section>
      ) : null}

      {applications.data ? <PaginationControls meta={applications.data.meta} onPage={changePage} /> : null}
    </div>
  );
}

/** Protects the seller-application review page with the admin-review permission. */
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
