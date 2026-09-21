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
import { useCommissionsReportQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_DEFAULT_SORT, REPORTS_PERMISSION } from "../reports.constants";
import { reportExportFilters } from "../reports.filters";
import type { CommissionsReportParams, ReportUiFilters } from "../types/reports.types";

/** Builds a typed Commission query from current UI filters. */
function commissionParams(filters: ReportUiFilters, page: number): CommissionsReportParams {
  return {
    page,
    pageSize: 20,
    from: filters.from,
    to: filters.to,
    sellerId: filters.sellerId,
    currency: filters.currency,
    sort: (filters.sort ?? REPORT_DEFAULT_SORT.commissions) as CommissionsReportParams["sort"],
  };
}

/** Maps immutable commission-entry semantics to a visual status without changing ledger meaning. */
function entryTone(entryType: string): "positive" | "negative" | "warning" {
  if (entryType === "sale") return "positive";
  if (entryType === "refund") return "negative";
  return "warning";
}

/** Renders immutable Commission entries and marketplace Commission revenue separately. */
function CommissionsReportContent({ user }: { user: Parameters<typeof ReportFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<ReportUiFilters>({ sort: REPORT_DEFAULT_SORT.commissions });
  const [page, setPage] = useState(1);
  const params = commissionParams(filters, page);
  const report = useCommissionsReportQuery(params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports / Finance"
        title="Commission report"
        description="Marketplace revenue is shown from immutable commission entries, not customer payment totals."
      />

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
          setFilters({ ...next, sort: next.sort ?? REPORT_DEFAULT_SORT.commissions });
          setPage(1);
        }}
      />
      <ReportExportControls user={user} reportCode={REPORT_CODE.COMMISSIONS} filters={reportExportFilters(params)} />

      {report.isPending ? <LoadingState label="Loading Commission report..." /> : null}
      {report.isError ? (
        <ErrorState
          title="Commission report could not be loaded"
          message={report.error instanceof Error ? report.error.message : "Please try again."}
          requestId={report.error instanceof ApiClientError ? report.error.requestId : undefined}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Commission report summary">
            <ReportResultCount label="Commission entries" totalItems={report.data.meta.totalItems} />
            <ReportMoneySummary
              title="Marketplace commission revenue"
              amounts={report.data.data.marketplaceCommissionRevenueByCurrency}
            />
          </section>
          <ReportTableSection
            title="Commission ledger detail"
            description="Immutable source entries for the active report scope."
            hasRows={report.data.data.rows.length > 0}
            emptyTitle="No commission rows match these filters"
            footer={<ReportPagination meta={report.data.meta} onPageChange={setPage} />}
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-muted text-foreground-muted">
                <tr>
                  <th scope="col" className="p-3">Type</th>
                  <th scope="col" className="p-3">Gross</th>
                  <th scope="col" className="p-3">Commission</th>
                  <th scope="col" className="p-3">Seller net</th>
                  <th scope="col" className="p-3">Occurred</th>
                </tr>
              </thead>
              <tbody>
                {report.data.data.rows.map((row) => (
                  <tr key={row.commissionEntryId} className="border-t border-border">
                    <td className="p-3"><StatusPill tone={entryTone(row.entryType)}>{row.entryType}</StatusPill></td>
                    <td className="p-3">{formatMoney(row.grossAmount, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.commissionAmount, row.currency)}</td>
                    <td className="p-3">{formatMoney(row.sellerNetAmount, row.currency)}</td>
                    <td className="p-3">{formatDateTime(row.occurredAt)}</td>
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

/** Protects Commission reporting with reports.finance.read. */
export function CommissionsReportPage() {
  return (
    <ReportsLayout>
      {(user) => (
        <RequireReportPermission user={user} permission={REPORTS_PERMISSION.FINANCE_READ}>
          <CommissionsReportContent user={user} />
        </RequireReportPermission>
      )}
    </ReportsLayout>
  );
}
