import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Surface } from "@/components/ui/surface";
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
      <PageHeader
        eyebrow="Operations · Audit"
        title="Audit log"
        description="Search append-only, server-redacted audit metadata. Seller scope and record visibility remain enforced by the API."
      />

      {audit.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Matching records" value={audit.data.meta.totalItems.toLocaleString()} />
          <StatCard label="Visible on this page" value={audit.data.items.length.toLocaleString()} />
          <StatCard label="Page" value={`${audit.data.meta.page} / ${Math.max(audit.data.meta.totalPages, 1)}`} />
        </div>
      ) : null}

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

      {audit.isPending ? <LoadingState label="Loading audit records..." /> : null}
      {audit.isError ? (
        <ErrorState
          title="Audit records could not be loaded"
          message={audit.error instanceof Error ? audit.error.message : "Please try again."}
          onRetry={() => void audit.refetch()}
        />
      ) : null}

      {audit.data ? (
        <Surface padding="none" className="overflow-hidden">
          <AuditTable items={audit.data.items} />
          <div className="px-5 pb-5 md:px-6 md:pb-6">
            <PaginationControls meta={audit.data.meta} onPage={setPage} />
          </div>
        </Surface>
      ) : null}
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
