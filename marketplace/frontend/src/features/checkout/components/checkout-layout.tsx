import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CHECKOUT_PERMISSION } from "../checkout.constants";

/** Returns true when the authenticated customer can create/read their own Checkout quote. */
function canUseCheckout(user: AuthenticatedUser): boolean {
  return (
    user.accountType === "customer" &&
    user.permissions.includes(CHECKOUT_PERMISSION.CREATE_OWN)
  );
}

/** Protects Checkout with account type plus the required frontend convenience permission check. */
function CheckoutPermissionGate({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  if (!canUseCheckout(user)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to create a customer Checkout quote."
      />
    );
  }
  return <>{children}</>;
}

/** Authenticated Checkout shell; the global AppShell already supplies the enclosed Checkout header. */
export function CheckoutLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <CheckoutPermissionGate user={user}>{children(user)}</CheckoutPermissionGate>
      )}
    </AuthenticatedPanel>
  );
}
