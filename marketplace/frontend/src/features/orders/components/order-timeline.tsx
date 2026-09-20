import type { z } from "zod";
import type { orderStatusHistorySchema } from "../schemas/orders.schemas";
import { OrderStatus } from "./order-status";

type TimelineEntry = z.infer<typeof orderStatusHistorySchema>;

/** Renders server-owned Order/Seller Order status history in chronological order. */
export function OrderTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No status history is available yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3" aria-label="Order status timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">
                {entry.fromStatus ?? "Created"}
              </span>
              <span>→</span>
              <OrderStatus value={entry.toStatus} />
            </div>
            <time className="text-xs text-slate-500">
              {new Date(entry.changedAt).toLocaleString()}
            </time>
          </div>
          {entry.reason ? (
            <p className="mt-2 text-sm text-slate-600">{entry.reason}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
