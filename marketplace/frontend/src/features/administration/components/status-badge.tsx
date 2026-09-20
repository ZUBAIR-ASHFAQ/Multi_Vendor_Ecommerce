import { cn } from "@/lib/cn";

/** Displays a compact status label without treating UI color as an authorization rule. */
export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
        active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700",
      )}
    >
      {status}
    </span>
  );
}
