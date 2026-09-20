import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Styled native select; keeps native keyboard and accessibility behavior. */
export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-foreground shadow-sm",
        "focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/20",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
        "aria-invalid:border-negative aria-invalid:ring-2 aria-invalid:ring-negative/15",
        className,
      )}
      {...props}
    />
  );
}
