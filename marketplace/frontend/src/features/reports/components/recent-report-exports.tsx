import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { formatDateTime } from "@/lib/dates";
import { useReportRunsQuery } from "../hooks/use-reports";
import { REPORT_LABELS, REPORT_RUN_STATUS } from "../reports.constants";

const RECENT_EXPORT_LIMIT = 6;

/** Maps report-run lifecycle to the shared semantic status treatment. */
function runTone(status: string): "neutral" | "positive" | "warning" | "negative" | "info" {
  if (status === REPORT_RUN_STATUS.COMPLETED) return "positive";
  if (status === REPORT_RUN_STATUS.FAILED) return "negative";
  if (status === REPORT_RUN_STATUS.PROCESSING) return "info";
  if (status === REPORT_RUN_STATUS.QUEUED) return "warning";
  return "neutral";
}

/** Shows durable requester-owned exports loaded directly from the server. */
export function RecentReportExports({ userId }: { userId: string }) {
  const history = useReportRunsQuery(userId, { page: 1, pageSize: RECENT_EXPORT_LIMIT });

  return (
    <Surface>
      <SectionHeader
        title="Recent exports"
        description="Your latest exports are stored on the server and stay available across browsers and devices."
      />

      {history.isPending ? (
        <p className="mt-4 text-sm text-foreground-muted" role="status">Loading export history...</p>
      ) : history.isError ? (
        <EmptyState
          className="mt-4"
          title="Export history unavailable"
          description="Recent exports could not be loaded. Existing report pages are still available."
        />
      ) : history.data.data.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No recent exports"
          description="Create a CSV or PDF export from any report and it will appear here."
        />
      ) : (
        <div className="mt-4 divide-y divide-border">
          {history.data.data.map((run) => (
            <div key={run.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{REPORT_LABELS[run.reportCode]}</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  {run.outputFormat.toUpperCase()} · {formatDateTime(run.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                <Link
                  to="/reports/runs/$runId"
                  params={{ runId: run.id }}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}
