interface LoadingStateProps {
  label?: string;
}

/** Accessible generic loading indicator for route/query boundaries. */
export function LoadingState({ label = "Loading" }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border bg-white p-4">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      <span className="text-sm text-slate-700">{label}</span>
    </div>
  );
}
