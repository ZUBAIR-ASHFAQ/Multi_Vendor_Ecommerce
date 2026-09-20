import type { ReactNode } from "react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/cn";

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** KPI/card primitive; formatting and business calculations remain with the calling feature. */
export function StatCard({ label, value, meta, icon, className }: StatCardProps) {
  return (
    <Surface className={cn("relative overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground-muted">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {meta ? <div className="mt-2 text-xs leading-5 text-foreground-muted">{meta}</div> : null}
        </div>
        {icon ? <div className="shrink-0 rounded-control bg-surface-muted p-2 text-foreground-muted" aria-hidden="true">{icon}</div> : null}
      </div>
    </Surface>
  );
}
