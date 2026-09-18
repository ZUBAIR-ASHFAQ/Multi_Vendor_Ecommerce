import { ShipmentStatus } from "./shipment-status";

interface TimelineEntry {
  status: string;
  occurredAt: string;
  source?: string;
}

/** Formats an API timestamp for human display without changing stored UTC data. */
function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Renders seller or customer-safe Shipment timeline rows in returned order. */
export function ShipmentTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No Shipment history is available yet.</p>;
  }

  return (
    <ol className="space-y-2" aria-label="Shipment timeline">
      {entries.map((entry, index) => (
        <li key={`${entry.status}-${entry.occurredAt}-${index}`} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ShipmentStatus value={entry.status} />
            <time className="text-xs text-slate-500" dateTime={entry.occurredAt}>
              {displayDate(entry.occurredAt)}
            </time>
          </div>
          {entry.source ? <p className="mt-1 text-xs text-slate-500">Source: {entry.source}</p> : null}
        </li>
      ))}
    </ol>
  );
}
