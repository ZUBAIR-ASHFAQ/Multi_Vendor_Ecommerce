import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  REPORT_FILTER_PRESET_STORAGE_KEY,
  type ReportCode,
} from "../reports.constants";
import { reportFilterPresetSchema } from "../schemas/reports.schemas";
import type { ReportFilterPreset, ReportUiFilters } from "../types/reports.types";

/** Builds one per-user browser key so locally saved filters do not bleed across signed-in accounts. */
function storageKey(userId: string): string {
  return `${REPORT_FILTER_PRESET_STORAGE_KEY}.${userId}`;
}

/** Reads valid local presets and ignores corrupt browser storage safely. */
function readPresets(userId: string): ReportFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = reportFilterPresetSchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Persists the complete preset list for the current browser user. */
function writePresets(userId: string, presets: ReportFilterPreset[]): void {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(presets));
}

/** Provides lightweight browser-local filter presets because the approved Reports API has no saved-filter routes. */
export function SavedReportFilters({
  userId,
  reportCode,
  filters,
  onLoad,
}: {
  userId: string;
  reportCode: ReportCode;
  filters: ReportUiFilters;
  onLoad: (filters: ReportUiFilters) => void;
}) {
  const [name, setName] = useState("");
  const [presets, setPresets] = useState<ReportFilterPreset[]>(() => readPresets(userId));
  const reportPresets = useMemo(
    () => presets.filter((preset) => preset.reportCode === reportCode),
    [presets, reportCode],
  );

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="font-semibold">Saved filters</p>
      <p className="mt-1 text-xs text-slate-500">
        These presets stay on this browser. The approved nine-route Reports API does not expose server saved-filter commands.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="Saved report filter name"
          className="min-w-56 rounded-md border px-3 py-2 text-sm"
          maxLength={80}
          placeholder="Preset name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!name.trim()}
          onClick={() => {
            const next = [
              ...presets,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                reportCode,
                filters: { ...filters },
              },
            ];
            writePresets(userId, next);
            setPresets(next);
            setName("");
          }}
        >
          Save current filters
        </Button>
      </div>

      {reportPresets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No saved filters for this report.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {reportPresets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-1 rounded-md border p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onLoad(preset.filters as ReportUiFilters)}
              >
                {preset.name}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete saved filter ${preset.name}`}
                onClick={() => {
                  const next = presets.filter((item) => item.id !== preset.id);
                  writePresets(userId, next);
                  setPresets(next);
                }}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
