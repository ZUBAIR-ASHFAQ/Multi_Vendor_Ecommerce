import { Link } from "@tanstack/react-router";
import type { AuditLogSummary } from "../types/documents-audit.types";

/** Formats one ISO audit timestamp for compact local display. */
function formatAuditTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Renders the permission-filtered append-only audit search results. */
export function AuditTable({ items }: { items: AuditLogSummary[] }) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No audit records matched the filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-slate-500">
            <th className="py-2">Time</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Actor</th>
            <th>Seller</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr key={entry.id} className="border-b align-top">
              <td className="py-3 whitespace-nowrap">{formatAuditTime(entry.createdAt)}</td>
              <td className="font-medium">{entry.action}</td>
              <td>
                {entry.resourceType}
                {entry.resourceId ? <span className="block text-xs text-slate-500">{entry.resourceId}</span> : null}
              </td>
              <td>
                {entry.actorType}
                {entry.actorUserId ? <span className="block text-xs text-slate-500">{entry.actorUserId}</span> : null}
              </td>
              <td>{entry.sellerId ?? "—"}</td>
              <td className="text-right">
                <Link className="underline" to="/audit/$auditId" params={{ auditId: entry.id }}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
