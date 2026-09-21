import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { formatDateTime } from "@/lib/dates";
import { DocumentsAuditLayout } from "../components/documents-audit-layout";
import { RequireModulePermission } from "../components/module-permission-gate";
import { DOCUMENT_AUDIT_PERMISSION } from "../documents-audit.constants";
import { useAuditLogQuery } from "../hooks/use-documents-audit";

/** Formats redacted audit snapshot JSON for a readable detail view. */
function snapshotText(value: unknown | null): string {
  if (value === null) return "None";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Snapshot could not be formatted.";
  }
}

/** Loads and renders one append-only audit detail record. */
function AuditDetailContent({ auditId }: { auditId: string }) {
  const audit = useAuditLogQuery(auditId);

  if (audit.isPending) return <LoadingState label="Loading audit detail..." />;
  if (audit.isError) {
    return (
      <ErrorState
        title="Audit detail could not be loaded"
        message={audit.error instanceof Error ? audit.error.message : "Please try again."}
        onRetry={() => void audit.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations · Audit record"
        title={audit.data.action}
        description={formatDateTime(audit.data.createdAt)}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="info">Append-only record</StatusPill>
            <Button asChild variant="outline">
              <Link to="/audit">Back to audit</Link>
            </Button>
          </div>
        )}
      />

      <Surface>
        <SectionHeader
          title="Record metadata"
          description="This audit record is read-only. Values shown here are the server-redacted representation returned by the audit API."
        />
        <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Resource type</dt>
            <dd className="mt-1 break-all text-foreground">{audit.data.resourceType}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Resource ID</dt>
            <dd className="mt-1 break-all font-mono text-sm text-foreground">{audit.data.resourceId ?? "—"}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Actor type</dt>
            <dd className="mt-1 text-foreground">{audit.data.actorType.replaceAll("_", " ")}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Actor user ID</dt>
            <dd className="mt-1 break-all font-mono text-sm text-foreground">{audit.data.actorUserId ?? "system"}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Seller ID</dt>
            <dd className="mt-1 break-all font-mono text-sm text-foreground">{audit.data.sellerId ?? "—"}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Request ID</dt>
            <dd className="mt-1 break-all font-mono text-sm text-foreground">{audit.data.requestId ?? "—"}</dd>
          </div>
        </dl>
      </Surface>

      <section className="grid gap-5 lg:grid-cols-2" aria-label="Read-only audit snapshots">
        <Surface>
          <SectionHeader title="Before" description="Redacted state captured before the audited action." />
          <pre className="mt-4 max-h-[32rem] overflow-auto rounded-control bg-slate-950 p-4 text-xs leading-5 text-slate-100" aria-label="Before snapshot">
            {snapshotText(audit.data.before)}
          </pre>
        </Surface>
        <Surface>
          <SectionHeader title="After" description="Redacted state captured after the audited action." />
          <pre className="mt-4 max-h-[32rem] overflow-auto rounded-control bg-slate-950 p-4 text-xs leading-5 text-slate-100" aria-label="After snapshot">
            {snapshotText(audit.data.after)}
          </pre>
        </Surface>
      </section>
    </div>
  );
}

/** Protects one audit detail route with the approved audit-read permission. */
export function AuditDetailPage() {
  const { auditId } = useParams({ strict: false }) as { auditId: string };

  return (
    <DocumentsAuditLayout>
      {(user) => (
        <RequireModulePermission user={user} permission={DOCUMENT_AUDIT_PERMISSION.AUDIT_READ}>
          <AuditDetailContent auditId={auditId} />
        </RequireModulePermission>
      )}
    </DocumentsAuditLayout>
  );
}
