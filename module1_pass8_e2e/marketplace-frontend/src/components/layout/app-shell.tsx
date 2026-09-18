import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MiniCart } from "@/features/cart-wishlist/components/mini-cart";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { env } from "@/lib/env";

interface AppShellProps {
  children: ReactNode;
}

/** Global shell remains neutral; business navigation stays inside owning feature modules. */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-bold">
            {env.VITE_APP_NAME}
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/search" className="rounded-md px-3 py-2 hover:bg-slate-50">
              Search
            </Link>
            <Link to="/search/stores" className="rounded-md px-3 py-2 hover:bg-slate-50">
              Stores
            </Link>
            <Link to="/products" className="rounded-md px-3 py-2 hover:bg-slate-50">
              Browse Products
            </Link>
            <MiniCart load={false} />
            <NotificationBell />
            <Link to="/wishlist" className="rounded-md px-3 py-2 hover:bg-slate-50">
              Wishlist
            </Link>
            <Link to="/orders" className="rounded-md px-3 py-2 hover:bg-slate-50">
              Orders
            </Link>
            <Link
              to="/login"
              className="rounded-md border px-3 py-2 hover:bg-slate-50"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
