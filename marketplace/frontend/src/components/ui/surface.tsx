import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const surfaceVariants = cva("rounded-card border border-border", {
  variants: {
    variant: {
      default: "bg-surface",
      muted: "bg-surface-muted",
      elevated: "bg-surface-elevated shadow-card",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      default: "p-5 md:p-6",
      lg: "p-6 md:p-8",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "default",
  },
});

export interface SurfaceProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

/** Neutral container primitive for cards, forms, and workspace panels. */
export function Surface({ className, variant, padding, ...props }: SurfaceProps) {
  return <div className={cn(surfaceVariants({ variant, padding }), className)} {...props} />;
}
