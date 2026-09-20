import { Link } from "@tanstack/react-router";

const linkClass = "marketplace-mobile-nav-link";
const activeClass = "marketplace-mobile-nav-link marketplace-mobile-nav-link-active";

/** Compact public navigation kept reachable at thumb level on small screens. */
export function MobileMarketplaceNav() {
  return (
    <nav className="marketplace-mobile-nav" aria-label="Mobile marketplace navigation">
      <Link to="/" className={linkClass} activeOptions={{ exact: true }} activeProps={{ className: activeClass }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
        <span>Home</span>
      </Link>
      <Link to="/search" className={linkClass} activeProps={{ className: activeClass }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" /></svg>
        <span>Search</span>
      </Link>
      <Link to="/wishlist" className={linkClass} activeProps={{ className: activeClass }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
        <span>Wishlist</span>
      </Link>
      <Link to="/orders" className={linkClass} activeProps={{ className: activeClass }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Zm3 5h6M9 12h6" /></svg>
        <span>Orders</span>
      </Link>
      <Link to="/account" className={linkClass} activeProps={{ className: activeClass }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" /></svg>
        <span>Account</span>
      </Link>
    </nav>
  );
}
