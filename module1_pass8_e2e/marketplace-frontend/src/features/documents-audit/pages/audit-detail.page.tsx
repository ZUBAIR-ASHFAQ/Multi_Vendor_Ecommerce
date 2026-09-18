import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
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
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Audit entry</p>
            <h1 className="mt-1 text-2xl font-bold">{audit.data.action}</h1>
            <p className="mt-1 text-sm text-slate-600">{formatDateTime(audit.data.createdAt)}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/audit">Back to audit</Link>
          </Button>
        </div>

        <dl className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-slate-500">Resource</dt>
            <dd className="mt-1 break-all">
              {audit.data.resourceType} · {audit.data.resourceId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Actor</dt>
            <dd className="mt-1 break-all">
              {audit.data.actorType} · {audit.data.actorUserId ?? "system"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Seller</dt>
            <dd className="mt-1 break-all">{audit.data.sellerId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Request ID</dt>
            <dd className="mt-1 break-all">{audit.data.requestId ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Before</h2>
          <pre className="mt-3 overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{snapshotText(audit.data.before)}</pre>
        </article>
        <article className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">After</h2>
          <pre className="mt-3 overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{snapshotText(audit.data.after)}</pre>
        </article>
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
