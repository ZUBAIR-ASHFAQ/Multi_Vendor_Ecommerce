import { Link } from "@tanstack/react-router";
import { env } from "@/lib/env";
import { BrandMark } from "./brand-mark";

/** Public marketplace footer shown outside operational workspaces and checkout. */
export function MarketplaceFooter() {
  return (
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
  );
}
