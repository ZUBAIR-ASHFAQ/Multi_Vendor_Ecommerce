import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { RecentReportExports } from "../components/recent-report-exports";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportPagination } from "../components/report-pagination";
import { ReportResultCount } from "../components/report-result-count";
import { RequireReportPermission, ReportsLayout } from "../components/reports-layout";
import { ReportTableSection } from "../components/report-table-section";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { useSellersReportQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_DEFAULT_SORT, REPORTS_PERMISSION } from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type { ReportUiFilters, SellersReportParams } from "../types/reports.types";

/** Builds a typed Seller-performance query from current UI filters. */
function sellerParams(filters: ReportUiFilters, page: number): SellersReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    currency: filters.currency,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.sellers) as SellersReportParams["sort"],
  };
}

/** Renders seller performance while keeping each financial concept separate. */
function SellersReportContent({ user }: { user: Parameters<typeof ReportFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<ReportUiFilters>({ sort: REPORT_DEFAULT_SORT.sellers });
  const [page, setPage] = useState(1);
  const params = sellerParams(filters, page);
  const report = useSellersReportQuery(params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports / Marketplace"
        title="Seller performance"
        description="GMV, marketplace commission revenue, seller payable, refunds, and payouts remain separately labeled source values."
      />

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.SELLERS}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.SELLERS}
        filters={filters}
        onLoad={(next) => {
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.sellers });
          setPage(1);
        }}
      />
      <ReportExportControls user={user} reportCode={REPORT_CODE.SELLERS} filters={reportExportFilters(params)} />

      {report.isPending ? <LoadingState label="Loading seller performance..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Seller report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={report.error instanceof ApiClientError ? report.error.requestId : undefined}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ReportResultCount label="Seller/currency rows" totalItems={report.data.meta.totalItems} />
          </div>
          <ReportTableSection
            title="Seller performance detail"
            description="Financial concepts stay separate so the table can be reconciled against source ledgers."
            hasRows={report.data.data.rows.length > 0}
            emptyTitle="No seller performance rows match these filters"
            footer={<ReportPagination meta={report.data.meta} onPageChange={setPage} />}
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-muted text-foreground-muted">
                <tr>
                  <th scope="col" className="p-3">Seller</th>
                  <th scope="col" className="p-3">Orders</th>
                  <th scope="col" className="p-3">GMV</th>
                  <th scope="col" className="p-3">Commission</th>
                  <th scope="col" className="p-3">Seller payable</th>
                  <th scope="col" className="p-3">Refunds</th>
                  <th scope="col" className="p-3">Payouts</th>
                </tr>
              </thead>
              <tbody>
                {report.data.data.rows.map((row) => (
                  <tr key={`${row.sellerId}-${row.currency}`} className="border-t border-border">
                    <td className="p-3 font-medium text-foreground">{row.sellerName}</td>
                    <td className="p-3">{row.orderCount.toLocaleString()}</td>
                    <td className="p-3">{formatMoney(row.gmv, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.commissionRevenue, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.sellerPayable, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.refunds, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.payouts, row.currency)}</td>
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

/** Protects Seller performance with reports.seller.read. */
export function SellersReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission user={user} permission={REPORTS_PERMISSION.SELLER_READ}>
          <SellersReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
