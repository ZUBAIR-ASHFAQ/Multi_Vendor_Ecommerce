import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";
import { FormError } from "@/features/auth/components/form-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  REPORT_OUTPUT_FORMAT,
  REPORTS_PERMISSION,
  type ReportCode,
} from "../reports.constants";
import { useCreateReportRunMutation } from "../hooks/use-reports";
import { rememberRecentReportRun } from "../reports.history";

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
    <Surface className="space-y-3">
      <SectionHeader
        title="Export current filters"
        description="Exports run asynchronously and never use browser-calculated totals."
        actions={(
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
                  .then((run) => {
                    rememberRecentReportRun(user.id, {
                      id: run.id,
                      reportCode: run.reportCode,
                      outputFormat: run.outputFormat,
                      createdAt: run.createdAt,
                    });
                    return navigate({ to: "/reports/runs/$runId", params: { runId: run.id } });
                  });
              }}
            >
              Export {outputFormat.toUpperCase()}
            </Button>
          ))}
          </div>
        )}
      />
      <FormError error={createRun.error} />
    </Surface>
  );
}
