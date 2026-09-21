import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { RecentReportExports } from "../components/recent-report-exports";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportPagination } from "../components/report-pagination";
import { ReportResultCount } from "../components/report-result-count";
import { RequireReportPermission, ReportsLayout } from "../components/reports-layout";
import { ReportTableSection } from "../components/report-table-section";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { useInventoryReportQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_DEFAULT_SORT, REPORTS_PERMISSION } from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type { InventoryReportParams, ReportUiFilters } from "../types/reports.types";

/** Builds a typed Inventory query from current UI filters. */
function inventoryParams(filters: ReportUiFilters, page: number): InventoryReportParams {
  return {
    page,
    pageSize: 20,
    sellerId: filters.sellerId,
    storeId: filters.storeId,
    lowStockOnly: filters.lowStockOnly,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.inventory) as InventoryReportParams["sort"],
  };
}

/** Renders current Inventory and low-stock reporting without changing stock state. */
function InventoryReportContent({ user }: { user: Parameters<typeof ReportFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<ReportUiFilters>({ sort: REPORT_DEFAULT_SORT.inventory });
  const [page, setPage] = useState(1);
  const params = inventoryParams(filters, page);
  const report = useInventoryReportQuery(params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports / Inventory"
        title="Inventory & low stock"
        description="Available quantity is reported from inventory source state; reports never mutate stock."
      />

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.INVENTORY}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.INVENTORY}
        filters={filters}
        onLoad={(next) => {
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.inventory });
          setPage(1);
        }}
      />
      <ReportExportControls user={user} reportCode={REPORT_CODE.INVENTORY} filters={reportExportFilters(params)} />

      {report.isPending ? <LoadingState label="Loading inventory report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Inventory report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={report.error instanceof ApiClientError ? report.error.requestId : undefined}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ReportResultCount label="Inventory rows" totalItems={report.data.meta.totalItems} />
          </div>
          <ReportTableSection
            title="Inventory detail"
            description="Current quantities and reorder thresholds for the active scope."
            hasRows={report.data.data.rows.length > 0}
            emptyTitle="No inventory rows match these filters"
            footer={<ReportPagination meta={report.data.meta} onPageChange={setPage} />}
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-muted text-foreground-muted">
                <tr>
                  <th scope="col" className="p-3">SKU</th>
                  <th scope="col" className="p-3">On hand</th>
                  <th scope="col" className="p-3">Reserved</th>
                  <th scope="col" className="p-3">Available</th>
                  <th scope="col" className="p-3">Reorder level</th>
                  <th scope="col" className="p-3">Risk</th>
                  <th scope="col" className="p-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {report.data.data.rows.map((row) => (
                  <tr key={row.inventoryItemId} className="border-t border-border">
                    <td className="p-3 font-medium text-foreground">{row.sku}</td>
                    <td className="p-3">{row.onHandQty}</td>
                    <td className="p-3">{row.reservedQty}</td>
                    <td className="p-3">{row.availableQty}</td>
                    <td className="p-3">{row.reorderLevel ?? "—"}</td>
                    <td className="p-3">
                      <StatusPill tone={row.lowStock ? "warning" : "positive"}>
                        {row.lowStock ? "Low stock" : "Normal"}
                      </StatusPill>
                    </td>
                    <td className="p-3">{formatDateTime(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableSection>
        </>
      ) : null}

      {user.permissions.includes(REPORTS_PERMISSION.EXPORT) ? <RecentReportExports userId={user.id} /> : null}
    </div>
  );
}

/** Protects Inventory reporting with reports.inventory.read. */
export function InventoryReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission user={user} permission={REPORTS_PERMISSION.INVENTORY_READ}>
          <InventoryReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
