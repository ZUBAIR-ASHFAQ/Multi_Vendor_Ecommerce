import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { ReportsLayout } from "../components/reports-layout";
import { useReportRunQuery } from "../hooks/use-reports";
import { REPORT_LABELS, REPORT_RUN_STATUS, REPORTS_PERMISSION } from "../reports.constants";

/** Maps asynchronous export lifecycle to shared semantic status tones. */
function runTone(status: string): "neutral" | "positive" | "warning" | "negative" | "info" {
  if (status === REPORT_RUN_STATUS.COMPLETED) return "positive";
  if (status === REPORT_RUN_STATUS.FAILED) return "negative";
  if (status === REPORT_RUN_STATUS.PROCESSING) return "info";
  if (status === REPORT_RUN_STATUS.QUEUED) return "warning";
  return "neutral";
}

/** Renders one requester-owned asynchronous export run and its short-lived download link. */
function ReportRunContent({ runId }: { runId: string }) {
  const run = useReportRunQuery(runId);

  if (run.isPending) return <LoadingState label="Loading report export..." />;
  if (run.isError) {
    return (
      <ErrorState
        title="Report export could not be loaded"
        message={run.error instanceof Error ? run.error.message : "Please try again."}
        requestId={run.error instanceof ApiClientError ? run.error.requestId : undefined}
        onRetry={() => void run.refetch()}
      />
    );
  }

  const value = run.data;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Report export"
        title={REPORT_LABELS[value.reportCode]}
        description="Requester-owned asynchronous export generated from the server-authoritative report scope."
        actions={<StatusPill tone={runTone(value.status)}>{value.status}</StatusPill>}
      />

      <Surface>
        <SectionHeader title="Export details" />
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-medium text-foreground-muted">Format</dt>
            <dd className="mt-1 font-semibold text-foreground">{value.outputFormat.toUpperCase()}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Created</dt>
            <dd className="mt-1 text-foreground">{formatDateTime(value.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Started</dt>
            <dd className="mt-1 text-foreground">{value.startedAt ? formatDateTime(value.startedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Finished</dt>
            <dd className="mt-1 text-foreground">{value.finishedAt ? formatDateTime(value.finishedAt) : "—"}</dd>
          </div>
        </dl>
      </Surface>

      {value.status === REPORT_RUN_STATUS.FAILED ? (
        <ErrorState
          title="Export failed"
          message={value.errorCode ?? "The export could not be generated."}
          onRetry={() => void run.refetch()}
        />
      ) : null}

      {value.status === REPORT_RUN_STATUS.QUEUED || value.status === REPORT_RUN_STATUS.PROCESSING ? (
        <LoadingState label="The export is still processing. This page refreshes automatically..." />
      ) : null}

      {value.status === REPORT_RUN_STATUS.COMPLETED && value.download ? (
        <Surface>
          <SectionHeader
            title="Export ready"
            description={`The signed download link expires at ${formatDateTime(value.download.expiresAt)}.`}
            actions={(
              <Button asChild>
                <a href={value.download.downloadUrl} target="_blank" rel="noreferrer">
                  Download export
                </a>
              </Button>
            )}
          />
        </Surface>
      ) : null}

      <Button variant="outline" asChild>
        <Link to="/reports">Back to report catalog</Link>
      </Button>
    </div>
  );
}

/** Protects export-run status with reports.export before the requester-owned server check runs. */
export function ReportRunPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  return (
    <ReportsLayout>
      {(user) =>
        user.permissions.includes(REPORTS_PERMISSION.EXPORT) ? (
          <ReportRunContent runId={runId} />
        ) : (
          <ErrorState
            title="Access denied"
            message="Your account does not have permission to read report exports."
          />
        )
      }
    </ReportsLayout>
  );
}
