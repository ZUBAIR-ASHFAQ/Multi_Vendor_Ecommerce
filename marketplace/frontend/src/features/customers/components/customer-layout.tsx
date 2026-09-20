import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CustomerAccountLayout } from "./customer-account-shell";
import { CUSTOMER_PERMISSION, hasCustomerPermission } from "../customers.constants";

/** Protects a customer page and supplies the authenticated actor to its child content. */
export function CustomerLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return <CustomerAccountLayout>{children}</CustomerAccountLayout>;
}

/** Renders a clear permission state when the actor cannot use one customer workflow. */
export function RequireCustomerPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (user.accountType !== "customer" || !hasCustomerPermission(user.permissions, permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to use this customer feature."
      />
    );
  }
  return <>{children}</>;
}
