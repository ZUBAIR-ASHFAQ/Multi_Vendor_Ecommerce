import type { ReactNode } from "react";
import { AccessDeniedState } from "@/components/feedback/system-state";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { hasPermission } from "../administration.constants";

/** Shows children only when the authenticated actor holds the required permission. */
export function PermissionGate({
  user,
  permission,
  children,
  fallback = null,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return hasPermission(user.permissions, permission) ? <>{children}</> : <>{fallback}</>;
}

/** Renders a friendly access-denied state when a whole page requires one permission. */
export function RequirePagePermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (!hasPermission(user.permissions, permission)) {
    return <AccessDeniedState message="Your account does not have permission to view this administration page." />;
  }
  return <>{children}</>;
}
