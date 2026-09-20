import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Styled native input; preserves all browser and form semantics. */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-foreground shadow-sm",
        "placeholder:text-foreground-muted/70",
        "focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/20",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
        "aria-invalid:border-negative aria-invalid:ring-2 aria-invalid:ring-negative/15",
        className,
      )}
      {...props}
    />
  );
}
