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
import { useCommissionsReportQuery } from "../hooks/use-reports";
import {
  REPORT_CODE,
  REPORT_DEFAULT_SORT,
  REPORTS_PERMISSION,
} from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type {
  CommissionsReportParams,
  ReportUiFilters,
} from "../types/reports.types";

/** Builds a typed Commission query from current UI filters. */
function commissionParams(
  filters: ReportUiFilters,
  page: number,
): CommissionsReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    currency: filters.currency,
    sort: (
      filters.sort ?? REPORT_DEFAULT_SORT.commissions
    ) as CommissionsReportParams["sort"],
  };
}

/** Renders immutable Commission entries and marketplace Commission revenue separately. */
function CommissionsReportContent({
  user,
}: {
  user: Parameters<typeof ReportFilterForm>[0]["user"];
}) {
  const [filters, setFilters] = useState<ReportUiFilters>({
    sort: REPORT_DEFAULT_SORT.commissions,
  });
  const [page, setPage] = useState(1);
  const params = commissionParams(filters, page);
  const report = useCommissionsReportQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Commission report</h1>
        <p className="mt-1 text-sm text-slate-600">
          Marketplace revenue is shown from immutable Commission entries, not
          customer payment totals.
        </p>
      </section>

      <ReportFilterForm
        key={JSON.stringify(filters)}
        user={user}
        reportCode={REPORT_CODE.COMMISSIONS}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <SavedReportFilters
        userId={user.id}
        reportCode={REPORT_CODE.COMMISSIONS}
        filters={filters}
        onLoad={(next) => {
          setFilters({
            ...next,
            sort: next.sort ?? REPORT_DEFAULT_SORT.commissions,
          });
          setPage(1);
        }}
      />
      <ReportExportControls
        user={user}
        reportCode={REPORT_CODE.COMMISSIONS}
        filters={reportExportFilters(params)}
      />

      {report.isPending ? <LoadingState label="Loading Commission report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Commission report could not be loaded"
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
            title="Marketplace Commission revenue"
            amounts={report.data.data.marketplaceCommissionRevenueByCurrency}
          />
          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            {report.data.data.rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">
                No Commission rows match these filters.
              </p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Type</th>
                    <th className="p-3">Gross</th>
                    <th className="p-3">Commission</th>
                    <th className="p-3">Seller net</th>
                    <th className="p-3">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.rows.map((row) => (
                    <tr key={row.commissionEntryId} className="border-t">
                      <td className="p-3">{row.entryType}</td>
                      <td className="p-3">
                        {formatMoney(row.grossAmount, row.currency)}
                      </td>
                      <td className="p-3">
                        {formatMoney(row.commissionAmount, row.currency)}
                      </td>
                      <td className="p-3">
                        {formatMoney(row.sellerNetAmount, row.currency)}
                      </td>
                      <td className="p-3">{formatDateTime(row.occurredAt)}</td>
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

/** Protects Commission reporting with reports.finance.read. */
export function CommissionsReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission
          user={user}
          permission={REPORTS_PERMISSION.FINANCE_READ}
        >
          <CommissionsReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
