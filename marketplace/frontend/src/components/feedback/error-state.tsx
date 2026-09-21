import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}

/** Presents a safe user-facing error while visually demoting its support reference. */
export function ErrorState({
  title = "Something went wrong",
  message,
  requestId,
  onRetry,
}: ErrorStateProps) {
  return (
    <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5">
      <h2 className="font-semibold text-red-950">{title}</h2>
      <p className="mt-1 text-sm text-red-900">{message}</p>
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {requestId ? (
        <p className="mt-4 border-t border-red-200/70 pt-3 text-xs text-red-700/80">
          Technical reference: <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
    </section>
  );
}
