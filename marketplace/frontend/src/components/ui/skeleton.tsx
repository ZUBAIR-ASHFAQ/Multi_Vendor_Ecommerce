import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Decorative loading placeholder. The parent loading boundary should provide status text. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-muted", className)}
      {...props}
    />
  );
}
