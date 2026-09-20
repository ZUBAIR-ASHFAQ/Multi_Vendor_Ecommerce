import { RETURN_STATUS_LABEL } from "../returns-refunds.constants";
import type { ReturnRequest } from "../types/returns-refunds.types";

interface ReturnTimelineEntry {
  id: string;
  label: string;
  at: string | null;
  reason: string | null;
  current: boolean;
}

/** Builds the timeline from persisted history and keeps a small fallback for older API responses. */
function buildTimelineEntries(value: ReturnRequest): ReturnTimelineEntry[] {
  const history = value.history ?? [];

  if (history.length > 0) {
    return history.map((entry, index) => ({
      id: entry.id,
      label: RETURN_STATUS_LABEL[entry.toStatus],
      at: entry.changedAt,
      reason: entry.reason,
      current: index === history.length - 1 && entry.toStatus === value.status,
    }));
  }

  const entries: ReturnTimelineEntry[] = [
    {
      id: `${value.id}-requested`,
      label: "Requested",
      at: value.requestedAt,
      reason: null,
      current: value.status === "requested",
    },
  ];

  if (value.approvedAt) {
    entries.push({
      id: `${value.id}-approved`,
      label: "Approved",
      at: value.approvedAt,
      reason: null,
      current: value.status === "approved",
    });
  }

  if (value.status !== "requested" && value.status !== "approved") {
    entries.push({
      id: `${value.id}-${value.status}`,
      label: RETURN_STATUS_LABEL[value.status],
      at: null,
      reason: null,
      current: true,
    });
  }

  return entries;
}

/** Renders persisted Return lifecycle facts without inventing missing timestamps or reasons. */
export function ReturnTimeline({ value }: { value: ReturnRequest }) {
  const entries = buildTimelineEntries(value);

  return (
    <ol className="space-y-2" aria-label={`Return timeline for ${value.returnNo}`}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-3 rounded-md border bg-slate-50 px-3 py-2 text-sm"
        >
          <div>
            <span className="font-medium">{entry.label}</span>
            {entry.reason ? (
              <p className="mt-1 text-xs text-slate-600">{entry.reason}</p>
            ) : null}
          </div>
          <span className="text-right text-xs text-slate-500">
            {entry.at
              ? new Date(entry.at).toLocaleString()
              : entry.current
                ? "Current state"
                : ""}
          </span>
        </li>
      ))}
      <li className="sr-only">Current server status: {RETURN_STATUS_LABEL[value.status]}</li>
    </ol>
  );
}
