import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/feedback/error-state";

/** Renders the shared access-denied system state. */
export function AccessDeniedState({
  message = "Your account does not have permission to view this page.",
}: {
  message?: string;
}) {
  return <ErrorState title="Access denied" message={message} />;
}

/** Renders the shared temporarily-unavailable system state. */
export function UnavailableState({
  message = "This page is temporarily unavailable. Please try again.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return <ErrorState title="Page unavailable" message={message} onRetry={onRetry} />;
}

/** Announces a successful operation without interrupting focus. */
export function SuccessFeedback({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="rounded-control border border-positive/20 bg-positive-soft p-3 text-sm text-positive">
      {children}
    </div>
  );
}

/** Announces neutral asynchronous operation feedback. */
export function OperationFeedback({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="rounded-control border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
      {children}
    </p>
  );
}

/** Renders the shared empty-search result state. */
export function EmptySearchState({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      title="No products found"
      description="Try a broader search or remove one of the active filters."
      icon={<span className="text-3xl">◇</span>}
      action={action}
    />
  );
}

/** Renders the shared empty-cart state. */
export function EmptyCartState({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      title="Your Cart is empty"
      description="Browse the marketplace and add a Product variant when you are ready."
      icon={<span className="text-3xl">◇</span>}
      action={action}
    />
  );
}

/** Renders the shared empty-orders state. */
export function EmptyOrdersState({ description, action }: { description: ReactNode; action?: ReactNode }) {
  return <EmptyState title="No Orders found" description={description} action={action} />;
}
