import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportMoneySummary } from "../components/report-money-summary";
import { ReportPagination } from "../components/report-pagination";
import {
  RequireReportPermission,
  ReportsLayout,
} from "../components/reports-layout";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { useRefundsReportQuery } from "../hooks/use-reports";
import {
  REPORT_CODE,
  REPORT_DEFAULT_SORT,
  REPORTS_PERMISSION,
} from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type {
  RefundsReportParams,
  ReportUiFilters,
} from "../types/reports.types";

/** Builds a typed Refund query from current UI filters. */
function refundParams(
  filters: ReportUiFilters,
  page: number,
): RefundsReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    storeId: filters.storeId,
    currency: filters.currency,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.refunds) as RefundsReportParams["sort"],
  };
}

/** Renders finalized Return/refund reporting from original source economics. */
function RefundsReportContent({
  user,
}: {
  user: Parameters<typeof ReportFilterForm>[0]["user"];
}) {
  const [filters, setFilters] = useState<ReportUiFilters>({
    sort: REPORT_DEFAULT_SORT.refunds,
  });
  const [page, setPage] = useState(1);
  const params = refundParams(filters, page);
  const report = useRefundsReportQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Returns & refunds report</h1>
        <p className="mt-1 text-sm text-slate-600">
          Refund totals come from finalized source records; Reports does not recompute
          order economics.
        </p>
      </section>

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.REFUNDS}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.REFUNDS}
        filters={filters}
        onLoad={(next) => {
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.refunds });
          setPage(1);
        }}
      />
      <ReportExportControls
        user={user}
        reportCode={REPORT_CODE.REFUNDS}
        filters={reportExportFilters(params)}
      />

      {report.isPending ? <LoadingState label="Loading refund report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Refund report could not be loaded"
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
          <ReportMoneySummary
            title="Completed refunds"
            amounts={report.data.data.refundedByCurrency}
          />
          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            {report.data.data.rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">
                No refund rows match these filters.
              </p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Refund</th>
                    <th className="p-3">Order</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.rows.map((row) => (
                    <tr key={row.refundId} className="border-t">
                      <td className="p-3 break-all">{row.refundId}</td>
                      <td className="p-3 break-all">{row.orderId}</td>
                      <td className="p-3">{row.status}</td>
                      <td className="p-3">{formatMoney(row.amount, row.currency)}</td>
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

/** Protects Return/refund reporting with reports.finance.read. */
export function RefundsReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission
          user={user}
          permission={REPORTS_PERMISSION.FINANCE_READ}
        >
          <RefundsReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
