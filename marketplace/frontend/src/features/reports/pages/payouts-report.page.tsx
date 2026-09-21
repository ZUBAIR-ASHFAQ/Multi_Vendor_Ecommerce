import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { RecentReportExports } from "../components/recent-report-exports";
import { ReportExportControls } from "../components/report-export-controls";
import { ReportMoneySummary } from "../components/report-money-summary";
import { ReportPagination } from "../components/report-pagination";
import { ReportResultCount } from "../components/report-result-count";
import { RequireReportPermission, ReportsLayout } from "../components/reports-layout";
import { ReportTableSection } from "../components/report-table-section";
import { SavedReportFilters } from "../components/saved-report-filters";
import { ReportFilterForm } from "../forms/report-filter.form";
import { usePayoutsReportQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_DEFAULT_SORT, REPORTS_PERMISSION } from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type { PayoutsReportParams, ReportUiFilters } from "../types/reports.types";

/** Builds a typed Payout query from current UI filters. */
function payoutParams(filters: ReportUiFilters, page: number): PayoutsReportParams {
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

/** Maps payout lifecycle states onto semantic visual tones. */
function payoutTone(status: string): "neutral" | "positive" | "warning" | "negative" | "info" {
  if (status === "paid") return "positive";
  if (status === "failed" || status === "reversed") return "negative";
  if (status === "processing") return "info";
  if (status === "requested" || status === "approved") return "warning";
  return "neutral";
}

/** Renders seller liability and paid Payouts as distinct finance concepts. */
function PayoutsReportContent({ user }: { user: Parameters<typeof ReportFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<ReportUiFilters>({ sort: REPORT_DEFAULT_SORT.payouts });
  const [page, setPage] = useState(1);
  const params = payoutParams(filters, page);
  const report = usePayoutsReportQuery(params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports / Finance"
        title="Seller payouts & liability"
        description="Seller payable and money already paid out remain separate server-authoritative values."
      />

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
      <ReportExportControls user={user} reportCode={REPORT_CODE.PAYOUTS} filters={reportExportFilters(params)} />

      {report.isPending ? <LoadingState label="Loading Payout report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Payout report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={report.error instanceof ApiClientError ? report.error.requestId : undefined}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Payout report summary">
            <ReportResultCount label="Payout records" totalItems={report.data.meta.totalItems} />
            <ReportMoneySummary title="Seller payable" amounts={report.data.data.sellerPayableByCurrency} />
            <ReportMoneySummary title="Payouts paid" amounts={report.data.data.paidOutByCurrency} />
          </section>
          <ReportTableSection
            title="Payout detail"
            description="Underlying payout records for the active seller and date scope."
            hasRows={report.data.data.rows.length > 0}
            emptyTitle="No payout rows match these filters"
            footer={<ReportPagination meta={report.data.meta} onPageChange={setPage} />}
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-muted text-foreground-muted">
                <tr>
                  <th scope="col" className="p-3">Payout</th>
                  <th scope="col" className="p-3">Seller</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Amount</th>
                  <th scope="col" className="p-3">Requested</th>
                  <th scope="col" className="p-3">Processed</th>
                </tr>
              </thead>
              <tbody>
                {report.data.data.rows.map((row) => (
                  <tr key={row.payoutId} className="border-t border-border">
                    <td className="p-3 font-medium text-foreground">{row.payoutNo}</td>
                    <td className="p-3 break-all">{row.sellerId}</td>
                    <td className="p-3"><StatusPill tone={payoutTone(row.status)}>{row.status}</StatusPill></td>
                    <td className="p-3">{formatMoney(row.amount, row.currency)}</td>
                    <td className="p-3">{formatDateTime(row.requestedAt)}</td>
                    <td className="p-3">{row.processedAt ? formatDateTime(row.processedAt) : "—"}</td>
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

/** Protects Payout reporting with reports.finance.read. */
export function PayoutsReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission user={user} permission={REPORTS_PERMISSION.FINANCE_READ}>
          <PayoutsReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
