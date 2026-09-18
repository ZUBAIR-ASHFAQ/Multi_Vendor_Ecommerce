import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { hasDocumentPermission } from "../documents-audit.constants";

/** Renders a whole-page access denial when the server-derived permission is missing. */
export function RequireModulePermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (!hasDocumentPermission(user.permissions, permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to use this Documents & Audit page."
      />
    );
  }
  return <>{children}</>;
}
