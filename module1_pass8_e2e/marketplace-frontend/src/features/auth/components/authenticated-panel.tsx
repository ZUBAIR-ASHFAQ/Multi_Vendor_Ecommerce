import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { AUTH_REQUIRED_EVENT } from "@/lib/auth";
import { useCurrentUserQuery } from "../hooks/use-auth";
import type { AuthenticatedUser } from "../types/auth.types";

/** Loads the authenticated actor and redirects expired sessions back to sign in. */
export function AuthenticatedPanel({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  const navigate = useNavigate();
  const currentUser = useCurrentUserQuery();

  useEffect(() => {
    /** Redirects the current visitor to login after the API reports an expired session. */
    const redirect = () => {
      void navigate({ to: "/login" });
    };

    window.addEventListener(AUTH_REQUIRED_EVENT, redirect);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, redirect);
  }, [navigate]);

  useEffect(() => {
    if (currentUser.error instanceof ApiClientError && currentUser.error.status === 401) {
      void navigate({ to: "/login" });
    }
  }, [currentUser.error, navigate]);

  if (currentUser.isPending) {
    return <LoadingState label="Loading account..." />;
  }

  if (currentUser.isError) {
    if (currentUser.error instanceof ApiClientError && currentUser.error.status === 401) {
      return <LoadingState label="Redirecting to sign in..." />;
    }

    return (
      <ErrorState
        title="Account could not be loaded"
        message={
          currentUser.error instanceof Error
            ? currentUser.error.message
            : "Please try again."
        }
        requestId={
          currentUser.error instanceof ApiClientError
            ? currentUser.error.requestId
            : undefined
        }
        onRetry={() => void currentUser.refetch()}
      />
    );
  }

  return <>{children(currentUser.data)}</>;
}
