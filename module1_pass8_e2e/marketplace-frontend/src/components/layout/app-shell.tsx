import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MiniCart } from "@/features/cart-wishlist/components/mini-cart";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { env } from "@/lib/env";

interface AppShellProps {
  children: ReactNode;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Global premium marketplace shell. Business authorization remains inside the owning feature modules. */
export function AppShell({ children }: AppShellProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isWorkspace = pathname === "/dashboard" || pathname.startsWith("/admin") || pathname.startsWith("/seller");

  return (
    <div className="marketplace-app min-h-screen text-slate-950">
      <header className="marketplace-header">
        <div className="marketplace-header-inner">
          <Link to="/" className="marketplace-brand" aria-label={`${env.VITE_APP_NAME} home`}>
            <BrandMark />
            <span>
              <strong>{env.VITE_APP_NAME}</strong>
              <small>multi-vendor commerce</small>
            </span>
          </Link>

          <Link to="/search" className="marketplace-search" aria-label="Search marketplace">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" /></svg>
            <span>Search products, brands, or categories…</span>
            <span className="marketplace-search-filter">All categories</span>
          </Link>

          <nav className="marketplace-actions" aria-label="Global navigation">
            <Link to="/wishlist" className="marketplace-action-link">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
              <span>Wishlist</span>
            </Link>
            <MiniCart load={false} />
            <NotificationBell />
            <Link to="/seller/apply" className="marketplace-sell-link">Start selling</Link>
            <Link to="/account" className="marketplace-avatar-link" aria-label="Account">
              <span className="marketplace-avatar">A</span>
              <span className="marketplace-avatar-copy">Account</span>
            </Link>
            <Link to="/login" className="marketplace-signin">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className={isWorkspace ? "marketplace-main marketplace-main-workspace" : "marketplace-main"}>
        {children}
      </main>

      {!isWorkspace ? (
        <footer className="marketplace-footer">
          <div className="marketplace-footer-inner">
            <div className="marketplace-footer-brand">
              <BrandMark />
              <div>
                <strong>{env.VITE_APP_NAME}</strong>
                <small>Independent stores. One trusted marketplace.</small>
              </div>
            </div>
            <nav aria-label="Footer navigation">
              <Link to="/products">Products</Link>
              <Link to="/search/stores">Stores</Link>
              <Link to="/seller/apply">Become a seller</Link>
              <Link to="/search">Discover</Link>
              <Link to="/register">Join</Link>
            </nav>
            <div className="marketplace-footer-note">Secure checkout · verified sellers · buyer-first service</div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
