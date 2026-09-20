import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Standard empty-result treatment for list, table, and account screens. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-card border border-dashed border-border-strong bg-surface px-6 py-10 text-center", className)}>
      {icon ? <div className="mx-auto mb-3 flex w-fit text-foreground-muted" aria-hidden="true">{icon}</div> : null}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-foreground-muted">{description}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
