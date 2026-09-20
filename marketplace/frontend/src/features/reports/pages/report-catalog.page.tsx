import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-error";
import { ReportsLayout } from "../components/reports-layout";
import { useReportsCatalogQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_LABELS, type ReportCode } from "../reports.constants";

type ReportDestination =
  | "/audit"
  | "/reports/sales"
  | "/reports/sellers"
  | "/reports/inventory"
  | "/reports/refunds"
  | "/reports/commissions"
  | "/reports/payouts";

/** Returns the typed frontend route that owns one catalog report code. */
function reportRoute(code: ReportCode): ReportDestination {
  switch (code) {
    case REPORT_CODE.SALES:
      return "/reports/sales";
    case REPORT_CODE.SELLERS:
      return "/reports/sellers";
    case REPORT_CODE.INVENTORY:
      return "/reports/inventory";
    case REPORT_CODE.REFUNDS:
      return "/reports/refunds";
    case REPORT_CODE.COMMISSIONS:
      return "/reports/commissions";
    case REPORT_CODE.PAYOUTS:
      return "/reports/payouts";
    case REPORT_CODE.AUDIT_LOG:
      return "/audit";
  }
}

/** Renders the permission-filtered Reports catalog returned by the server. */
function ReportCatalogContent() {
  const catalog = useReportsCatalogQuery();

  if (catalog.isPending) return <LoadingState label="Loading report catalog..." />;
  if (catalog.isError) {
    return (
      <ErrorState
        title="Report catalog could not be loaded"
        message={catalog.error instanceof Error ? catalog.error.message : "Please try again."}
        requestId={catalog.error instanceof ApiClientError ? catalog.error.requestId : undefined}
        onRetry={() => void catalog.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Report catalog</h1>
        <p className="mt-1 text-sm text-slate-600">
          Only reports allowed by your server-derived permissions are listed here.
        </p>
      </section>

      {catalog.data.length === 0 ? (
        <section className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
          No reports are available for your account.
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.data.map((report) => (
            <section key={report.code} className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{report.domain}</p>
              <h2 className="mt-1 text-lg font-bold">{REPORT_LABELS[report.code]}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Export formats: {report.outputFormats.map((format) => format.toUpperCase()).join(", ")}
              </p>
              <Button className="mt-4" variant="outline" asChild>
                <Link to={reportRoute(report.code)}>Open report</Link>
              </Button>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Protects the catalog with the shared authenticated Reports layout. */
export function ReportCatalogPage() {
  return <ReportsLayout>{() => <ReportCatalogContent />}</ReportsLayout>;
}
