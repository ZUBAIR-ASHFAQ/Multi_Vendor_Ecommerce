import { ApiClientError } from "@/lib/api-error";

/** Renders one safe request-level form error and its support request ID when available. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof ApiClientError || error instanceof Error
      ? error.message
      : "The request could not be completed.";
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{message}</p>
      {requestId ? <p className="mt-1 text-xs">Request ID: {requestId}</p> : null}
    </div>
  );
}

/** Extracts the first readable TanStack Form/Zod field validation message. */
export function firstFieldError(errors: unknown[]): string | null {
  const first = errors[0];
  if (typeof first === "string") return first;

  if (first && typeof first === "object" && "message" in first) {
    const message = (first as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }

  return null;
}
