import { StatCard } from "@/components/ui/stat-card";

/** Displays the server-reported filtered row count without deriving business metrics in the browser. */
export function ReportResultCount({ label, totalItems }: { label: string; totalItems: number }) {
  return (
    <StatCard
      label={label}
      value={totalItems.toLocaleString()}
      meta="Server-reported rows matching the current filters"
    />
  );
}
