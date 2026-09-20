import { Link } from "@tanstack/react-router";
import { env } from "@/lib/env";
import { BrandMark } from "./brand-mark";

/** Enclosed checkout chrome that removes storefront discovery distractions without changing Checkout logic. */
export function CheckoutHeader() {
  return (
    <header className="checkout-header">
      <div className="checkout-header-inner">
        <Link to="/" className="checkout-brand" aria-label={`${env.VITE_APP_NAME} home`}>
          <BrandMark />
          <strong>{env.VITE_APP_NAME}</strong>
        </Link>
        <div className="checkout-security" aria-label="Secure checkout">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12v10H6Z" /></svg>
          <span>Secure checkout</span>
        </div>
        <Link to="/cart" className="checkout-back-link">Back to cart</Link>
      </div>
    </header>
  );
}
