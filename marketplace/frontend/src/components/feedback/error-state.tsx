import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}

/** Presents a safe user-facing error without leaking raw exception details. */
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
      {requestId ? <p className="mt-2 text-xs text-red-700">Request ID: {requestId}</p> : null}
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </section>
  );
}
