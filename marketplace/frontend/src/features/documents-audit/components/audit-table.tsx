import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { AuditLogSummary } from "../types/documents-audit.types";

/** Formats one ISO audit timestamp for compact local display. */
function formatAuditTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Renders the permission-filtered append-only audit search results. */
export function AuditTable({ items }: { items: AuditLogSummary[] }) {
  if (items.length === 0) {
    return <p className="px-6 py-10 text-center text-sm text-foreground-muted">No audit records matched the filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[920px] w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs font-semibold uppercase tracking-[0.08em] text-foreground-muted">
          <tr>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">Resource</th>
            <th className="px-4 py-3">Actor</th>
            <th className="px-4 py-3">Seller</th>
            <th className="px-4 py-3 text-right">Record</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((entry) => (
            <tr key={entry.id} className="align-top transition-colors hover:bg-surface-muted/60">
              <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatAuditTime(entry.createdAt)}</td>
              <td className="px-4 py-3 font-medium text-foreground">{entry.action}</td>
              <td className="px-4 py-3">
                <span className="block text-foreground">{entry.resourceType}</span>
                {entry.resourceId ? <span className="block break-all font-mono text-xs text-foreground-muted">{entry.resourceId}</span> : null}
              </td>
              <td className="px-4 py-3">
                <span className="block text-foreground">{entry.actorType.replaceAll("_", " ")}</span>
                {entry.actorUserId ? <span className="block break-all font-mono text-xs text-foreground-muted">{entry.actorUserId}</span> : null}
              </td>
              <td className="px-4 py-3 break-all font-mono text-xs text-foreground-muted">{entry.sellerId ?? "—"}</td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/audit/$auditId" params={{ auditId: entry.id }}>View</Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
