import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  REPORT_OUTPUT_FORMAT,
  REPORTS_PERMISSION,
  type ReportCode,
} from "../reports.constants";
import { useCreateReportRunMutation } from "../hooks/use-reports";

/** Queues a server-authoritative report export and opens its status page. */
export function ReportExportControls({
  user,
  reportCode,
  filters,
}: {
  user: AuthenticatedUser;
  reportCode: ReportCode;
  filters: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const createRun = useCreateReportRunMutation();

  if (!user.permissions.includes(REPORTS_PERMISSION.EXPORT)) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Export current filters</p>
          <p className="text-sm text-slate-600">Exports run asynchronously and never use browser-calculated totals.</p>
        </div>
        <div className="flex gap-2">
          {[REPORT_OUTPUT_FORMAT.CSV, REPORT_OUTPUT_FORMAT.PDF].map((outputFormat) => (
            <Button
              key={outputFormat}
              type="button"
              variant="outline"
              disabled={createRun.isPending}
              onClick={() => {
                void createRun
                  .mutateAsync({ reportCode, filters, outputFormat })
                  .then((run) => navigate({ to: "/reports/runs/$runId", params: { runId: run.id } }));
              }}
            >
              Export {outputFormat.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      <FormError error={createRun.error} />
    </div>
  );
}
