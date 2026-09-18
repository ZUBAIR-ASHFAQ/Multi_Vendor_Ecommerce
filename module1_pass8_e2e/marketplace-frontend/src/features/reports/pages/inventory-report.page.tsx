import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportPagination } from "../components/report-pagination";
import {
  RequireReportPermission,
  ReportsLayout,
} from "../components/reports-layout";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { useInventoryReportQuery } from "../hooks/use-reports";
import {
  REPORT_CODE,
  REPORT_DEFAULT_SORT,
  REPORTS_PERMISSION,
} from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type {
  InventoryReportParams,
  ReportUiFilters,
} from "../types/reports.types";

/** Builds a typed Inventory query from current UI filters. */
function inventoryParams(
  filters: ReportUiFilters,
  page: number,
): InventoryReportParams {
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
function InventoryReportContent({
  user,
}: {
  user: Parameters<typeof ReportFilterForm>[0]["user"];
}) {
  const [filters, setFilters] = useState<ReportUiFilters>({
    sort: REPORT_DEFAULT_SORT.inventory,
  });
  const [page, setPage] = useState(1);
  const params = inventoryParams(filters, page);
  const report = useInventoryReportQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Inventory & low stock</h1>
        <p className="mt-1 text-sm text-slate-600">
          Available quantity is reported from Inventory source state; Reports does not
          mutate stock.
        </p>
      </section>

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
          setFilters({
            ...next,
            sort: next.sort ?? REPORT_DEFAULT_SORT.inventory,
          });
          setPage(1);
        }}
      />
      <ReportExportControls
        user={user}
        reportCode={REPORT_CODE.INVENTORY}
        filters={reportExportFilters(params)}
      />

      {report.isPending ? <LoadingState label="Loading inventory report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Inventory report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={
            report.error instanceof ApiClientError
              ? report.error.requestId
              : undefined
          }
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            {report.data.data.rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">
                No inventory rows match these filters.
              </p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">SKU</th>
                    <th className="p-3">On hand</th>
                    <th className="p-3">Reserved</th>
                    <th className="p-3">Available</th>
                    <th className="p-3">Reorder level</th>
                    <th className="p-3">Risk</th>
                    <th className="p-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.rows.map((row) => (
                    <tr key={row.inventoryItemId} className="border-t">
                      <td className="p-3">{row.sku}</td>
                      <td className="p-3">{row.onHandQty}</td>
                      <td className="p-3">{row.reservedQty}</td>
                      <td className="p-3">{row.availableQty}</td>
                      <td className="p-3">{row.reorderLevel ?? "—"}</td>
                      <td className="p-3">{row.lowStock ? "Low stock" : "Normal"}</td>
                      <td className="p-3">{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <ReportPagination meta={report.data.meta} onPageChange={setPage} />
          </section>
        </>
      ) : null}
    </div>
  );
}

/** Protects Inventory reporting with reports.inventory.read. */
export function InventoryReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission
          user={user}
          permission={REPORTS_PERMISSION.INVENTORY_READ}
        >
          <InventoryReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
