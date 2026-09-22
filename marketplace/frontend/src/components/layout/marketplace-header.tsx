import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { CART_WISHLIST_PERMISSION } from "@/features/cart-wishlist/cart-wishlist.constants";
import { MiniCart } from "@/features/cart-wishlist/components/mini-cart";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { NOTIFICATIONS_PERMISSION } from "@/features/notifications/notifications.constants";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { SearchAutocomplete } from "@/features/search-discovery/components/search-autocomplete";
import { SEARCH_UI_LIMITS } from "@/features/search-discovery/search-discovery.constants";
import { env } from "@/lib/env";
import { BrandMark } from "./brand-mark";

interface MarketplaceHeaderProps {
  user?: AuthenticatedUser;
  isSessionLoading: boolean;
}

/** Public marketplace header. It reuses the existing Search, Cart, Notification, and Auth routes. */
export function MarketplaceHeader({ user, isSessionLoading }: MarketplaceHeaderProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const isCustomer = user?.accountType === "customer";
  const canManageCart =
    isCustomer && user.permissions.includes(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN);
  const canManageWishlist =
    isCustomer && user.permissions.includes(CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN);
  const canReadNotifications =
    user?.permissions.includes(NOTIFICATIONS_PERMISSION.READ_OWN) ?? false;
  const canStartSelling = !user || isCustomer;
  const avatarLabel = user?.displayName.trim().charAt(0).toUpperCase() || "A";

  /** Navigates to the canonical marketplace search route for one query. */
  function navigateToSearch(value: string): void {
    const normalized = value.trim();
    void navigate({
      to: "/search",
      search: {
        q: normalized || undefined,
        sort: "relevance",
        page: 1,
        pageSize: SEARCH_UI_LIMITS.PAGE_SIZE,
      },
    });
  }

  /** Submits the current marketplace search query. */
  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigateToSearch(query);
  }

  return (
    <header className="marketplace-header">
      <div className="marketplace-header-inner">
        <Link to="/" className="marketplace-brand" aria-label={`${env.VITE_APP_NAME} home`}>
          <BrandMark />
          <span>
            <strong>{env.VITE_APP_NAME}</strong>
            <small>multi-vendor commerce</small>
          </span>
        </Link>

        <Link to="/products" className="marketplace-category-link">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16" /></svg>
          <span>Categories</span>
        </Link>

        <div className="marketplace-search-wrap">
          <form className="marketplace-search" role="search" onSubmit={submitSearch}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" /></svg>
            <input
              aria-label="Search marketplace"
              type="search"
              autoComplete="off"
              maxLength={SEARCH_UI_LIMITS.QUERY_MAX_LENGTH}
              placeholder="Search products, brands, or categories…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit">Search</button>
          </form>
          <SearchAutocomplete
            value={query}
            onSelect={(suggestion) => {
              setQuery(suggestion);
              navigateToSearch(suggestion);
            }}
          />
        </div>

        <nav className="marketplace-actions" aria-label="Global navigation">
          {canManageWishlist ? (
            <Link to="/wishlist" className="marketplace-action-link marketplace-wishlist-link">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
              <span>Wishlist</span>
            </Link>
          ) : null}
          {!user || isCustomer ? <MiniCart load={Boolean(canManageCart)} /> : null}
          <NotificationBell enabled={canReadNotifications} />
          {canStartSelling ? <Link to="/seller/apply" className="marketplace-sell-link">Start selling</Link> : null}
          {user ? (
            <Link to="/account" className="marketplace-avatar-link" aria-label="Account">
              <span className="marketplace-avatar">{avatarLabel}</span>
              <span className="marketplace-avatar-copy">Account</span>
            </Link>
          ) : null}
          {!user && !isSessionLoading ? <Link to="/login" className="marketplace-signin">Sign in</Link> : null}
        </nav>
      </div>
    </header>
  );
}
