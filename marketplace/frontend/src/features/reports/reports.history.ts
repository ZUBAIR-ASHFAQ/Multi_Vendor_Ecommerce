import { reportRunHistoryEntrySchema } from "./schemas/reports.schemas";
import type { ReportRunHistoryEntry } from "./types/reports.types";

const HISTORY_PREFIX = "marketplace.report-run-history.v1";
const HISTORY_LIMIT = 6;

/** Uses a per-user browser key so export references never bleed between signed-in accounts. */
function historyKey(userId: string): string {
  return `${HISTORY_PREFIX}.${userId}`;
}

/** Reads valid recent run references and ignores malformed browser storage safely. */
export function readRecentReportRuns(userId: string): ReportRunHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = reportRunHistoryEntrySchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Remembers one newly created requester-owned run without creating a new backend history API. */
export function rememberRecentReportRun(userId: string, run: ReportRunHistoryEntry): void {
  try {
    const next = [run, ...readRecentReportRuns(userId).filter((item) => item.id !== run.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    window.localStorage.setItem(historyKey(userId), JSON.stringify(next));
  } catch {
    // Browser storage is convenience-only; export creation and navigation must still succeed.
  }
}
