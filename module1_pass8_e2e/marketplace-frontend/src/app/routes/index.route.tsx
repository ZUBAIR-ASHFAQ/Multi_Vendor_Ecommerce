import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { rootRoute } from "@/app/routes/root.route";

const categories = [
  { label: "Home & Living", count: "2.4k products", glyph: "⌂" },
  { label: "Electronics", count: "1.8k products", glyph: "◉" },
  { label: "Fashion", count: "4.2k products", glyph: "◇" },
  { label: "Accessories", count: "1.2k products", glyph: "◎" },
  { label: "Wellness", count: "860 products", glyph: "✦" },
  { label: "Gifts", count: "1.1k products", glyph: "□" },
] as const;

const featuredProducts = [
  { name: "Form Chair No. 04", store: "Atelier Home", price: "$189.00", oldPrice: "$229.00", rating: "4.9 (128)", badge: "Editor pick", art: "chair" },
  { name: "Arc Wireless Headphones", store: "Northstar Audio", price: "$249.00", oldPrice: "$299.00", rating: "4.8 (342)", badge: "Bestseller", art: "headphones" },
  { name: "Everyday Carry Tote", store: "Morrow Studio", price: "$74.00", oldPrice: null, rating: "4.7 (89)", badge: "New", art: "tote" },
  { name: "Sora Table Lamp", store: "Lumen Works", price: "$128.00", oldPrice: "$149.00", rating: "4.9 (211)", badge: "Popular", art: "lamp" },
] as const;

/** Premium public storefront landing page wired to the existing catalog, search, auth and cart routes. */
function FoundationHomePage() {
  return (
    <div className="storefront-home">
      <section className="storefront-hero">
        <div className="storefront-hero-copy">
          <p className="storefront-eyebrow"><span /> Curated multi-vendor marketplace</p>
          <h1>Better objects.<br />Independent makers.</h1>
          <p className="storefront-hero-lead">
            Discover considered products from verified sellers, with unified checkout, secure payments,
            order tracking and marketplace-grade buyer protection.
          </p>
          <div className="storefront-hero-actions">
            <Link to="/search" className="storefront-primary-cta">Explore collection <span>→</span></Link>
            <Link to="/search/stores" className="storefront-secondary-cta">Meet the sellers <span>⌂</span></Link>
          </div>
          <div className="storefront-trust-row" aria-label="Marketplace benefits">
            <div><strong>Secure payments</strong><span>Shop with confidence</span></div>
            <div><strong>Order tracking</strong><span>From store to door</span></div>
            <div><strong>Verified sellers</strong><span>Real makers, real products</span></div>
          </div>
        </div>

        <div className="storefront-hero-art" aria-hidden="true">
          <div className="hero-art-leaf hero-art-leaf-one" />
          <div className="hero-art-leaf hero-art-leaf-two" />
          <div className="hero-art-vase" />
          <div className="hero-art-table" />
          <div className="hero-art-chair"><span /></div>
          <p>A more<br />thoughtful<br />way to shop</p>
          <div className="storefront-stats">
            <div><strong>340+</strong><span>verified sellers</span></div>
            <div><strong>18k</strong><span>curated products</span></div>
            <div><strong>4.8/5</strong><span>buyer rating</span></div>
          </div>
        </div>
      </section>

      <section className="storefront-section">
        <div className="storefront-section-heading">
          <div>
            <p>Shop by collection</p>
            <h2>Find your next favorite</h2>
          </div>
          <Link to="/products">View all categories →</Link>
        </div>
        <div className="storefront-category-grid">
          {categories.map((category) => (
            <Link key={category.label} to="/search" className="storefront-category-card">
              <span className="storefront-category-glyph" aria-hidden="true">{category.glyph}</span>
              <span><strong>{category.label}</strong><small>{category.count}</small></span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="storefront-section">
        <div className="storefront-section-heading">
          <div>
            <p>Marketplace edit</p>
            <h2>Featured this week</h2>
            <span>High-performing products from trusted stores.</span>
          </div>
          <Link to="/products">Shop all →</Link>
        </div>
        <div className="storefront-product-grid">
          {featuredProducts.map((product) => (
            <article key={product.name} className="storefront-product-card">
              <div className={`storefront-product-art product-art-${product.art}`}>
                <span className="storefront-product-badge">{product.badge}</span>
                <Link to="/wishlist" className="storefront-heart" aria-label={`Save ${product.name}`}>♡</Link>
                <div className="product-art-object" aria-hidden="true" />
              </div>
              <div className="storefront-product-copy">
                <h3>{product.name}</h3>
                <p>{product.store}</p>
                <div className="storefront-rating"><span>★</span> {product.rating}</div>
                <div className="storefront-product-bottom">
                  <div><strong>{product.price}</strong>{product.oldPrice ? <del>{product.oldPrice}</del> : null}</div>
                  <Link to="/products" className="storefront-add" aria-label={`Browse ${product.name}`}>+</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="storefront-join">
        <div>
          <p>Built for buyers and independent businesses</p>
          <h2>Multi-vendor marketplace, one cohesive experience.</h2>
        </div>
        <div className="storefront-join-actions">
          <Button asChild><Link to="/seller/apply">Become a seller</Link></Button>
          <Button asChild variant="outline"><Link to="/login">Sign in</Link></Button>
          <Button asChild variant="outline"><Link to="/register">Create customer account</Link></Button>
          <Button asChild variant="outline"><Link to="/search">Search marketplace</Link></Button>
          <Button asChild variant="outline"><Link to="/products">Browse Products</Link></Button>
        </div>
      </section>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationHomePage,
});
