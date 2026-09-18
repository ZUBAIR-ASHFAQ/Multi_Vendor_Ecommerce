import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PaginationControls } from "@/features/administration/components/pagination-controls";
import { ReportExportControls } from "@/features/reports/components/report-export-controls";
import { REPORT_CODE } from "@/features/reports/reports.constants";
import { reportExportFilters } from "@/features/reports/reports.filters";
import { DocumentsAuditLayout } from "../components/documents-audit-layout";
import { RequireModulePermission } from "../components/module-permission-gate";
import { AuditTable } from "../components/audit-table";
import { AuditFilterForm } from "../forms/audit-filter-form";
import { DOCUMENT_AUDIT_PERMISSION } from "../documents-audit.constants";
import { useAuditLogsQuery } from "../hooks/use-documents-audit";
import type { AuditListParams } from "../types/documents-audit.types";

/** Loads one bounded page of append-only audit metadata with permission-safe filters. */
function AuditContent({ user }: { user: Parameters<typeof AuditFilterForm>[0]["user"] }) {
  const [filters, setFilters] = useState<AuditListParams>({ sort: "created_desc" });
  const [page, setPage] = useState(1);
  const audit = useAuditLogsQuery({ ...filters, page, pageSize: 20 });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          Search the append-only, server-redacted audit surface. Seller scope remains enforced by the API.
        </p>
      </div>

      <AuditFilterForm
        user={user}
        onApply={(nextFilters) => {
          setFilters(nextFilters);
          setPage(1);
        }}
      />

      {user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT) ? (
        <ReportExportControls
          user={user}
          reportCode={REPORT_CODE.AUDIT_LOG}
          filters={reportExportFilters(filters)}
        />
      ) : null}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        {audit.isPending && <LoadingState label="Loading audit records..." />}
        {audit.isError && (
          <ErrorState
            title="Audit records could not be loaded"
            message={audit.error instanceof Error ? audit.error.message : "Please try again."}
            onRetry={() => void audit.refetch()}
          />
        )}
        {audit.data && (
          <>
            <AuditTable items={audit.data.items} />
            <div className="mt-4">
              <PaginationControls meta={audit.data.meta} onPage={setPage} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Protects the audit search page with the backend-owned audit.read permission. */
export function AuditPage() {
  return (
    <DocumentsAuditLayout>
      {(user) => (
        <RequireModulePermission user={user} permission={DOCUMENT_AUDIT_PERMISSION.AUDIT_READ}>
          <AuditContent user={user} />
        </RequireModulePermission>
      )}
    </DocumentsAuditLayout>
  );
}
