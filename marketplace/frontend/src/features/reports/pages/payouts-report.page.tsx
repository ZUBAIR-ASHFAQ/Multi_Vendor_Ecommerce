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
import { usePayoutsReportQuery } from "../hooks/use-reports";
import {
  REPORT_CODE,
  REPORT_DEFAULT_SORT,
  REPORTS_PERMISSION,
} from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type {
  PayoutsReportParams,
  ReportUiFilters,
} from "../types/reports.types";

/** Builds a typed Payout query from current UI filters. */
function payoutParams(
  filters: ReportUiFilters,
  page: number,
): PayoutsReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    currency: filters.currency,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.payouts) as PayoutsReportParams["sort"],
  };
}

/** Renders seller liability and paid Payouts as distinct finance concepts. */
function PayoutsReportContent({
  user,
}: {
  user: Parameters<typeof ReportFilterForm>[0]["user"];
}) {
  const [filters, setFilters] = useState<ReportUiFilters>({
    sort: REPORT_DEFAULT_SORT.payouts,
  });
  const [page, setPage] = useState(1);
  const params = payoutParams(filters, page);
  const report = usePayoutsReportQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Seller payouts & liability</h1>
        <p className="mt-1 text-sm text-slate-600">
          Seller payable and money already paid out remain separate values.
        </p>
      </section>

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.PAYOUTS}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.PAYOUTS}
        filters={filters}
        onLoad={(next) => {
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.payouts });
          setPage(1);
        }}
      />
      <ReportExportControls
        user={user}
        reportCode={REPORT_CODE.PAYOUTS}
        filters={reportExportFilters(params)}
      />

      {report.isPending ? <LoadingState label="Loading Payout report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Payout report could not be loaded"
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
          <section className="grid gap-3 md:grid-cols-2">
            <ReportMoneySummary
              title="Seller payable"
              amounts={report.data.data.sellerPayableByCurrency}
            />
            <ReportMoneySummary
              title="Payouts paid"
              amounts={report.data.data.paidOutByCurrency}
            />
          </section>
          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            {report.data.data.rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">
                No Payout rows match these filters.
              </p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Payout</th>
                    <th className="p-3">Seller</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Requested</th>
                    <th className="p-3">Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.rows.map((row) => (
                    <tr key={row.payoutId} className="border-t">
                      <td className="p-3">{row.payoutNo}</td>
                      <td className="p-3 break-all">{row.sellerId}</td>
                      <td className="p-3">{row.status}</td>
                      <td className="p-3">{formatMoney(row.amount, row.currency)}</td>
                      <td className="p-3">{formatDateTime(row.requestedAt)}</td>
                      <td className="p-3">
                        {row.processedAt ? formatDateTime(row.processedAt) : "—"}
                      </td>
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

/** Protects Payout reporting with reports.finance.read. */
export function PayoutsReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission
          user={user}
          permission={REPORTS_PERMISSION.FINANCE_READ}
        >
          <PayoutsReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
