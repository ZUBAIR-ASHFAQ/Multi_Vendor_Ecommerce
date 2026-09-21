import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { ApiClientError } from "@/lib/api-error";
import { RecentReportExports } from "../components/recent-report-exports";
import { ReportsLayout } from "../components/reports-layout";
import { useReportsCatalogQuery } from "../hooks/use-reports";
import { REPORT_CODE, REPORT_LABELS, REPORTS_PERMISSION, type ReportCode } from "../reports.constants";

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
function ReportCatalogContent({ user }: { user: AuthenticatedUser }) {
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports & Analytics"
        title="Report catalog"
        description="Run permission-safe operational and financial reports from server-authoritative source data."
      />

      {catalog.data.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="Your current permissions do not expose any report definitions."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalog.data.map((report) => (
            <Surface key={report.code} className="flex h-full flex-col" variant="elevated">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                {report.domain}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">{REPORT_LABELS[report.code]}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-foreground-muted">
                Available as {report.outputFormats.map((format) => format.toUpperCase()).join(" and ")} exports.
              </p>
              <Button className="mt-5 w-fit" variant="outline" asChild>
                <Link to={reportRoute(report.code)}>Open report</Link>
              </Button>
            </Surface>
          ))}
        </div>
      )}

      {user.permissions.includes(REPORTS_PERMISSION.EXPORT) ? <RecentReportExports userId={user.id} /> : null}
    </div>
  );
}

/** Protects the catalog with the shared authenticated Reports layout. */
export function ReportCatalogPage() {
  return <ReportsLayout>{(user) => <ReportCatalogContent user={user} />}</ReportsLayout>;
}
