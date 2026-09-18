import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { ReportsLayout } from "../components/reports-layout";
import { useReportRunQuery } from "../hooks/use-reports";
import {
  REPORT_LABELS,
  REPORT_RUN_STATUS,
  REPORTS_PERMISSION,
} from "../reports.constants";

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
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Asynchronous export
        </p>
        <h1 className="mt-1 text-2xl font-bold">{REPORT_LABELS[value.reportCode]}</h1>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-semibold">Status</dt>
            <dd>{value.status}</dd>
          </div>
          <div>
            <dt className="font-semibold">Format</dt>
            <dd>{value.outputFormat.toUpperCase()}</dd>
          </div>
          <div>
            <dt className="font-semibold">Created</dt>
            <dd>{formatDateTime(value.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Finished</dt>
            <dd>{value.finishedAt ? formatDateTime(value.finishedAt) : "—"}</dd>
          </div>
        </dl>
      </section>

      {value.status === REPORT_RUN_STATUS.FAILED ? (
        <ErrorState
          title="Export failed"
          message={value.errorCode ?? "The export could not be generated."}
          onRetry={() => void run.refetch()}
        />
      ) : null}

      {value.status === REPORT_RUN_STATUS.QUEUED ||
      value.status === REPORT_RUN_STATUS.PROCESSING ? (
        <LoadingState label="The export is still processing. This page refreshes automatically..." />
      ) : null}

      {value.status === REPORT_RUN_STATUS.COMPLETED && value.download ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Export ready</h2>
          <p className="mt-1 text-sm text-slate-600">
            The signed link expires at {formatDateTime(value.download.expiresAt)}.
          </p>
          <Button className="mt-4" asChild>
            <a
              href={value.download.downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download export
            </a>
          </Button>
        </section>
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
