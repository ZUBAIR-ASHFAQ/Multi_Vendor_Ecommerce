import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-muted text-foreground-muted",
        positive: "border-positive/20 bg-positive-soft text-positive",
        warning: "border-warning/20 bg-warning-soft text-warning",
        negative: "border-negative/20 bg-negative-soft text-negative",
        info: "border-info/20 bg-info-soft text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface StatusPillProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {}

/** Semantic status treatment. Callers remain responsible for choosing the correct business-state tone. */
export function StatusPill({ className, tone, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ tone }), className)} {...props}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}
