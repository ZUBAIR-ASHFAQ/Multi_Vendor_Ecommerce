import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Styled native textarea with the same focus/error contract as Input and Select. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-foreground shadow-sm",
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
