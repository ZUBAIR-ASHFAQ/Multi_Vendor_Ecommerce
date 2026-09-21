import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { formatDateTime } from "@/lib/dates";
import { reportsApi } from "../api/reports.api";
import { reportsQueryKeys } from "../hooks/reports.query-keys";
import { REPORT_LABELS, REPORT_RUN_STATUS } from "../reports.constants";
import { readRecentReportRuns } from "../reports.history";

/** Maps report-run lifecycle to the shared semantic status treatment. */
function runTone(status: string): "neutral" | "positive" | "warning" | "negative" | "info" {
  if (status === REPORT_RUN_STATUS.COMPLETED) return "positive";
  if (status === REPORT_RUN_STATUS.FAILED) return "negative";
  if (status === REPORT_RUN_STATUS.PROCESSING) return "info";
  if (status === REPORT_RUN_STATUS.QUEUED) return "warning";
  return "neutral";
}

/** Shows recent browser-known exports while re-authorizing every run through the existing backend read API. */
export function RecentReportExports({ userId }: { userId: string }) {
  const recent = readRecentReportRuns(userId);
  const queries = useQueries({
    queries: recent.map((entry) => ({
      queryKey: reportsQueryKeys.run(entry.id),
      queryFn: () => reportsApi.getRun(entry.id),
      retry: false,
      staleTime: 10_000,
    })),
  });

  return (
    <Surface>
      <SectionHeader
        title="Recent exports"
        description="Exports created in this browser. Each status is revalidated by the server before it is shown."
      />

      {recent.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No recent exports"
          description="Create a CSV or PDF export from any report and it will appear here."
        />
      ) : (
        <div className="mt-4 divide-y divide-border">
          {recent.map((entry, index) => {
            const query = queries[index];
            const value = query?.data;
            return (
              <div key={entry.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{REPORT_LABELS[entry.reportCode]}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {entry.outputFormat.toUpperCase()} · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {value ? (
                    <StatusPill tone={runTone(value.status)}>{value.status}</StatusPill>
                  ) : query?.isError ? (
                    <StatusPill tone="neutral">Unavailable</StatusPill>
                  ) : (
                    <StatusPill tone="info">Checking</StatusPill>
                  )}
                  <Link
                    to="/reports/runs/$runId"
                    params={{ runId: entry.id }}
                    className="text-sm font-semibold text-brand hover:underline"
                  >
                    View
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
