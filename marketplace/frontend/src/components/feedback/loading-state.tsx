import { Skeleton } from "@/components/ui/skeleton";

export type LoadingStateVariant = "inline" | "cards" | "table" | "products";

interface LoadingStateProps {
  label?: string;
  variant?: LoadingStateVariant;
  count?: number;
}

/** Renders content-shaped skeleton placeholders for non-inline loading states. */
function LoadingSkeleton({ variant, count }: { variant: Exclude<LoadingStateVariant, "inline">; count: number }) {
  if (variant === "table") {
    return (
      <div className="overflow-hidden rounded-card border border-border bg-surface shadow-sm" aria-hidden="true">
        <div className="grid grid-cols-4 gap-4 border-b border-border bg-surface-muted px-4 py-3">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-3" />)}
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: count }, (_, row) => (
            <div key={row} className="grid grid-cols-4 gap-4 px-4 py-4">
              {Array.from({ length: 4 }, (_, column) => <Skeleton key={column} className="h-4" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "products") {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-card border border-border bg-surface p-3 shadow-sm">
            <Skeleton className="aspect-square w-full rounded-card" />
            <Skeleton className="mt-4 h-3 w-2/5" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-4 h-5 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-card border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Accessible generic loading boundary with optional content-shaped skeletons. */
export function LoadingState({ label = "Loading", variant = "inline", count = 4 }: LoadingStateProps) {
  if (variant !== "inline") {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
        <span className="sr-only">{label}</span>
        <LoadingSkeleton variant={variant} count={Math.max(1, count)} />
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-3 rounded-lg border bg-white p-4">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" aria-hidden="true" />
      <span className="text-sm text-slate-700">{label}</span>
    </div>
  );
}
