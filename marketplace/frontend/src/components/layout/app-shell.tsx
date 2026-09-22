import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { getPostLoginPath } from "@/features/auth/auth.navigation";
import { useCurrentUserQuery } from "@/features/auth/hooks/use-auth";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CheckoutHeader } from "./checkout-header";
import { MarketplaceFooter } from "./marketplace-footer";
import { MarketplaceHeader } from "./marketplace-header";
import { MobileMarketplaceNav } from "./mobile-marketplace-nav";

interface AppShellProps {
  children: ReactNode;
}

/** Returns true for the operational routes that already own seller/admin workspace navigation. */
export function isWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/documents") ||
    pathname.startsWith("/audit") ||
    (pathname.startsWith("/seller") && pathname !== "/seller/apply")
  );
}

/** Returns true only for the customer Checkout route that needs enclosed global chrome. */
export function isCheckoutPath(pathname: string): boolean {
  return pathname === "/checkout";
}

/** Global application shell. Business authorization remains inside the owning feature modules. */
export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentUser = useCurrentUserQuery();
  const previousAccountType = useRef<AuthenticatedUser["accountType"] | null>(null);

  useEffect(() => {
    const user = currentUser.data;
    if (!user) return;

    const previous = previousAccountType.current;
    previousAccountType.current = user.accountType;
    if (previous === "customer" && user.accountType === "seller") {
      void navigate({ to: getPostLoginPath(user), replace: true });
    }
  }, [currentUser.data, navigate]);
  const isWorkspace = isWorkspacePath(pathname);
  const isCheckout = isCheckoutPath(pathname);
  const isPublicChrome = !isWorkspace && !isCheckout;

  const mainClassName = isWorkspace
    ? "marketplace-main marketplace-main-workspace"
    : isCheckout
      ? "marketplace-main marketplace-main-checkout"
      : "marketplace-main";

  return (
    <div className={`marketplace-app min-h-screen text-slate-950${isPublicChrome ? " marketplace-app-public" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {isCheckout ? (
        <CheckoutHeader />
      ) : (
        <MarketplaceHeader
          user={currentUser.data}
          isSessionLoading={currentUser.isPending}
        />
      )}

      <main id="main-content" tabIndex={-1} className={mainClassName}>{children}</main>

      {isPublicChrome ? <MarketplaceFooter /> : null}
      {isPublicChrome ? (
        <MobileMarketplaceNav
          user={currentUser.data}
          isSessionLoading={currentUser.isPending}
        />
      ) : null}
    </div>
  );
}
