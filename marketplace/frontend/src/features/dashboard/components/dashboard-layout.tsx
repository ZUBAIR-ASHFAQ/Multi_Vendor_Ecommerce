import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { DASHBOARD_PERMISSION } from "../dashboard.constants";

/** Protects the Dashboard route with the server-derived base Dashboard permission. */
export function DashboardLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => {
        if (!user.permissions.includes(DASHBOARD_PERMISSION.READ)) {
          return (
            <ErrorState
              title="Access denied"
              message="Your account does not have permission to view the Dashboard."
            />
          );
        }
        return <>{children(user)}</>;
      }}
    </AuthenticatedPanel>
  );
}
