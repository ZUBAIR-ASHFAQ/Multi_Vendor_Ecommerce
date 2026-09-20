import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportMoneySummary } from "../components/report-money-summary";
import { ReportPagination } from "../components/report-pagination";
import { RequireReportPermission, ReportsLayout } from "../components/reports-layout";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { useSalesReportQuery } from "../hooks/use-reports";
import { reportExportFilters } from "../reports.filters";
import { REPORT_CODE, REPORT_DEFAULT_SORT, REPORTS_PERMISSION } from "../reports.constants";
import type { ReportUiFilters, SalesReportParams } from "../types/reports.types";

/** Builds a typed Sales query from the current UI filters. */
function salesParams(filters: ReportUiFilters, page: number): SalesReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    storeId: filters.storeId,
    currency: filters.currency,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.sales) as SalesReportParams["sort"],
  };
}

/** Renders permission-safe Sales/Orders rows and separate financial summaries. */
function SalesReportContent({ user }: { user: Parameters<typeof ReportFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<ReportUiFilters>({ sort: REPORT_DEFAULT_SORT.sales });
  const [page, setPage] = useState(1);
  const params = salesParams(filters, page);
  const report = useSalesReportQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Sales & orders report</h1>
        <p className="mt-1 text-sm text-slate-600">
          GMV, captured customer cash, and refunds remain separate server-defined values.
        </p>
      </section>

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.SALES}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.SALES}
        filters={filters}
        onLoad={(next) => {
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.sales });
          setPage(1);
        }}
      />
      <ReportExportControls user={user} reportCode={REPORT_CODE.SALES} filters={reportExportFilters(params)} />

      {report.isPending ? <LoadingState label="Loading sales report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Sales report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={report.error instanceof ApiClientError ? report.error.requestId : undefined}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <ReportMoneySummary title="GMV" amounts={report.data.data.summary.gmvByCurrency} />
            <ReportMoneySummary title="Captured cash" amounts={report.data.data.summary.capturedCashByCurrency} />
            <ReportMoneySummary title="Refunded payments" amounts={report.data.data.summary.refundsByCurrency} />
          </section>
          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            {report.data.data.rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No finalized sales rows match these filters.</p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Order</th>
                    <th className="p-3">Seller order</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Total</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.rows.map((row) => (
                    <tr key={row.sellerOrderId} className="border-t">
                      <td className="p-3">{row.orderNo}</td>
                      <td className="p-3">{row.sellerOrderNo}</td>
                      <td className="p-3">{row.orderStatus} / {row.sellerOrderStatus}</td>
                      <td className="p-3">{formatMoney(row.grandTotal, row.currency)}</td>
                      <td className="p-3">{formatDateTime(row.createdAt)}</td>
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

/** Protects the Sales report with reports.sales.read. */
export function SalesReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission user={user} permission={REPORTS_PERMISSION.SALES_READ}>
          <SalesReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
