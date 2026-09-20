import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
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
      {isCheckout ? <CheckoutHeader /> : <MarketplaceHeader />}

      <main className={mainClassName}>{children}</main>

      {isPublicChrome ? <MarketplaceFooter /> : null}
      {isPublicChrome ? <MobileMarketplaceNav /> : null}
    </div>
  );
}
